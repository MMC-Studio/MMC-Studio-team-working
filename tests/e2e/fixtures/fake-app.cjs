// Unity.exe / blender.exe GIẢ cho test (máy CI không có Unity / Blender). App chạy: node fake-app.cjs <exe> <argv thật…>.
// Unity: nhận -executeMethod / -logFile như thật, ghi log vào file đó. Blender: in ra stdout / stderr.
// Hành vi theo tên hàm / nội dung script: "Sleep" / SLEEP = chạy mãi (sinh thêm một tiến trình con — để test dừng CẢ CÂY,
// pid con ghi vào <log>.child hoặc <script>.child); "Fail" / FAIL = lỗi, mã thoát 1; BIG = output dài 200 KB.
const fs = require('fs')
const { spawn } = require('child_process')

const argv = process.argv.slice(3)
const after = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

function sleepForever(pidFile) {
  // detached: không nằm trong job object của node (node tự giết con khi chết) — giống tiến trình con của Unity thật.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: process.env, detached: true, windowsHide: true })
  child.unref()
  fs.writeFileSync(pidFile, String(child.pid))
  setInterval(() => {}, 1000)
}

const method = after('-executeMethod')
if (method !== undefined) {
  const logFile = after('-logFile')
  const write = (s) => fs.appendFileSync(logFile, s + '\n')
  fs.writeFileSync(logFile, `Fake Unity — projectPath ${after('-projectPath')}\n`)
  write('Compiling scripts… done')
  if (method.includes('Sleep')) {
    write('Đang chạy lâu…')
    sleepForever(logFile + '.child')
  } else if (method.includes('Fail')) {
    write(`error CS0103: The name 'oops' does not exist — ${method}`)
    process.exit(1)
  } else {
    write(`Executed ${method}: Build OK`)
    process.exit(0)
  }
} else {
  const script = after('--python')
  const content = fs.readFileSync(script, 'utf8')
  const dash = argv.indexOf('--')
  console.log(`Fake Blender — script ${script} args ${dash >= 0 ? argv.slice(dash + 1).join(',') : ''}`)
  if (argv.includes('--disable-autoexec')) console.log('autoexec: off')
  if (content.includes('BIG')) for (let i = 0; i < 4000; i++) console.log(`dòng ${i} `.padEnd(50, '.'))
  if (content.includes('SLEEP')) sleepForever(script + '.child')
  else if (content.includes('FAIL')) {
    console.error('Traceback (most recent call last):\nValueError: hỏng')
    process.exit(1)
  } else {
    console.log('Blender script done')
    process.exit(0)
  }
}
