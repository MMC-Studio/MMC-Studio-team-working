import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Hồ sơ theo loại dự án (Unity, Blender, DaVinci…): nhận diện thư mục, những chỗ trợ lý KHÔNG được
 * sửa, và vài lưu ý đưa vào ngữ cảnh. Thêm phần mềm mới = thêm một mục vào PROFILES, không phải
 * sửa luồng duyệt.
 */
export type ProjectProfile = {
  id: string
  /** Tên hiển thị trong ngữ cảnh gửi cho trợ lý. */
  label: string
  /** Thư mục gốc có phải loại dự án này không (chỉ kiểm tra vài file/thư mục ở gốc, không quét sâu). */
  detect(root: string, entries: string[]): boolean
  /** Đường dẫn tương đối (dấu /) bị cấm sửa → lý do; null = được sửa. */
  protect(rel: string): string | null
  /**
   * File được sửa nhưng KHÔNG BAO GIỜ tự duyệt (PR C) vì sửa nó có thể dẫn tới chạy code không qua thẻ → lý do;
   * null = tự duyệt được. Luôn hiện thẻ, kể cả khi đang có phiên tự duyệt.
   */
  askAlways?(rel: string): string | null
  /** Lưu ý ngắn cho trợ lý. */
  notes: string
}

const lower = (s: string): string => s.toLowerCase()
const under = (rel: string, dirs: string[]): boolean => {
  const first = lower(rel.split('/')[0] ?? '')
  return dirs.some((d) => lower(d) === first)
}
const hasExt = (entries: string[], exts: string[]): boolean =>
  entries.some((e) => exts.some((x) => lower(e).endsWith(x)))

/** File nhị phân / dự án dạng nhị phân: không bao giờ sửa bằng Edit/Write (sẽ hỏng file). */
const BINARY_EXTS = [
  '.blend', '.blend1', '.drp', '.drt', '.dra', '.fbx', '.glb', '.abc', '.usdc', '.usdz',
  '.png', '.jpg', '.jpeg', '.tga', '.psd', '.exr', '.hdr', '.tif', '.tiff', '.bmp', '.gif', '.webp',
  '.wav', '.mp3', '.ogg', '.flac', '.mp4', '.mov', '.mkv', '.avi', '.mxf', '.braw', '.r3d',
  '.dll', '.exe', '.so', '.dylib', '.pdb', '.zip', '.7z', '.rar', '.unitypackage', '.db', '.sqlite'
]

export function binaryReason(rel: string): string | null {
  const name = lower(rel)
  const ext = BINARY_EXTS.find((x) => name.endsWith(x))
  return ext ? `File ${ext} là nhị phân — sửa bằng văn bản sẽ làm hỏng file.` : null
}

/** Mọi dự án: thư mục của git / công cụ build không bao giờ sửa tay. */
const COMMON_PROTECTED = ['.git', 'node_modules', '.vs', '.idea']

export const PROFILES: ProjectProfile[] = [
  {
    id: 'unity',
    label: 'Unity',
    detect: (root, entries) => entries.includes('Assets') && existsSync(join(root, 'ProjectSettings')),
    protect: (rel) => {
      if (under(rel, ['Library', 'Temp', 'Logs', 'obj', 'Build', 'Builds', 'UserSettings']))
        return 'Thư mục do Unity tự sinh — sửa tay sẽ bị ghi đè hoặc làm hỏng project.'
      if (lower(rel).endsWith('.meta')) return 'File .meta giữ GUID; sửa sai là mất tham chiếu prefab/scene.'
      return null
    },
    // Unity Editor đang mở tự biên dịch mọi .cs và chạy [InitializeOnLoad] / [InitializeOnLoadMethod] — cả script
    // ngoài thư mục Editor/ (bọc trong #if UNITY_EDITOR) → không tách được, mọi .cs đều phải hỏi.
    askAlways: (rel) => {
      const name = lower(rel)
      if (name.endsWith('.cs')) return 'Unity tự biên dịch và có thể chạy script C# ngay khi Editor đang mở.'
      if (name.endsWith('.asmdef') || name.endsWith('.asmref')) return 'Định nghĩa assembly — đổi cách Unity biên dịch code.'
      if (name.endsWith('.rsp')) return 'Tham số trình biên dịch C# (có thể nạp analyzer / DLL).'
      if (name === 'packages/manifest.json') return 'Danh sách package — Unity tự tải và chạy code của package mới.'
      return null
    },
    notes:
      'Code nằm trong Assets/. Không đụng Library/, Temp/, file .meta. Scene/prefab (.unity, .prefab) là YAML dài — ' +
      'ưu tiên sửa script C#; nếu buộc phải sửa YAML thì sửa đúng chỗ nhỏ nhất. Lỗi biên dịch xem bằng log Unity.'
  },
  {
    id: 'blender',
    label: 'Blender',
    detect: (_root, entries) => hasExt(entries, ['.blend']),
    protect: () => null,
    notes:
      'File .blend là nhị phân — không đọc/sửa trực tiếp được. Thay đổi trong Blender nên viết thành script Python (.py) ' +
      'để người dùng chạy trong tab Scripting. Lỗi xem bằng log Blender.'
  },
  {
    id: 'davinci',
    label: 'DaVinci Resolve',
    detect: (_root, entries) => hasExt(entries, ['.drp', '.drt']),
    protect: () => null,
    notes:
      'Project DaVinci (.drp) là nhị phân/CSDL — không sửa trực tiếp. Có thể viết script Python/Lua cho Resolve ' +
      'hoặc file phụ (phụ đề .srt, EDL, LUT .cube) để người dùng nhập vào.'
  },
  {
    id: 'node',
    label: 'Node.js',
    detect: (_root, entries) => entries.includes('package.json'),
    protect: (rel) => (under(rel, ['dist', 'out', 'build']) ? 'Thư mục build tự sinh.' : null),
    notes: 'Không sửa file trong dist/, out/, build/.'
  }
]

export type ProjectInfo = { profiles: ProjectProfile[] }

/** Nhận diện loại dự án ở thư mục gốc. Lỗi đọc thư mục → coi như dự án chung. */
export function detectProject(root: string): ProjectInfo {
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return { profiles: [] }
  }
  return { profiles: PROFILES.filter((p) => p.detect(root, entries)) }
}

/** Lý do không được sửa đường dẫn này (tương đối, dấu /); null = được sửa. */
export function protectedReason(info: ProjectInfo, rel: string): string | null {
  if (under(rel, COMMON_PROTECTED)) return 'Thư mục hệ thống của git / công cụ — không sửa tay.'
  const binary = binaryReason(rel)
  if (binary) return binary
  for (const p of info.profiles) {
    const reason = p.protect(rel)
    if (reason) return `${p.label}: ${reason}`
  }
  return null
}

const fileName = (rel: string): string => lower(rel.split('/').pop() ?? '')
const inDir = (rel: string, dir: string): boolean => lower(rel).split('/').slice(0, -1).includes(dir)

/**
 * Mọi dự án: file có thể dẫn tới chạy lệnh (script, cấu hình build / CI / hook / công cụ) → không tự duyệt (PR C).
 * So theo tên file / thư mục ở MỌI cấp (package.json trong thư mục con vẫn chạy được `npm run`).
 */
function commonAskReason(rel: string): string | null {
  const name = fileName(rel)
  if (lower(rel).startsWith('.github/workflows/')) return 'Workflow GitHub Actions — chạy lệnh trên máy CI.'
  if (inDir(rel, '.claude') || name === '.mcp.json') return 'Cấu hình Claude Code (hook, MCP) — có thể chạy lệnh ở lượt sau.'
  if (inDir(rel, '.vscode')) return 'Cấu hình VS Code (task, launch) — có thể chạy lệnh.'
  if (inDir(rel, '.husky')) return 'Git hook — chạy lệnh khi commit / push.'
  if (name === 'package.json') return 'package.json có script chạy bằng npm.'
  if (name === '.npmrc') return 'Cấu hình npm — đổi nơi tải / script chạy khi cài.'
  if (name.startsWith('.env')) return 'File biến môi trường — đổi cách chương trình chạy, thường có khoá bí mật.'
  if (/\.(bat|cmd|ps1|psm1|sh)$/.test(name)) return 'Script chạy lệnh.'
  if (/\.(csproj|sln)$/.test(name) || name.startsWith('directory.build.'))
    return 'File dự án .NET / MSBuild — có thể chạy lệnh khi build.'
  // Dự án Unity nằm trong thư mục con của thư mục đã chọn (hồ sơ chỉ nhận diện ở gốc) — vẫn chặn theo dấu hiệu Unity.
  if (name.endsWith('.asmdef') || name.endsWith('.asmref')) return 'Unity: định nghĩa assembly — đổi cách Unity biên dịch code.'
  if (name.endsWith('.cs') && (inDir(rel, 'assets') || inDir(rel, 'packages')))
    return 'Unity: Editor đang mở tự biên dịch và có thể chạy script C#.'
  if (name === 'manifest.json' && inDir(rel, 'packages')) return 'Unity: danh sách package — Unity tự tải và chạy code của package mới.'
  return null
}

/**
 * Lý do vẫn phải hỏi (không tự duyệt) với đường dẫn tương đối `rel`; null = tự duyệt được. Gọi với cả đường dẫn chữ và
 * đường dẫn thật (junction) — một trong hai khớp là phải hỏi.
 */
export function askAlwaysReason(info: ProjectInfo, rel: string): string | null {
  const common = commonAskReason(rel)
  if (common) return common
  for (const p of info.profiles) {
    const reason = p.askAlways?.(rel)
    if (reason) return `${p.label}: ${reason}`
  }
  return null
}

/** Đoạn ngữ cảnh cho trợ lý: loại dự án + lưu ý. Dự án không nhận diện được → chuỗi rỗng. */
export function projectNotes(info: ProjectInfo): string {
  if (info.profiles.length === 0) return ''
  return info.profiles.map((p) => `Dự án ${p.label}: ${p.notes}`).join('\n')
}
