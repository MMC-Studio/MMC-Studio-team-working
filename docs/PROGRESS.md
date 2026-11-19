# Tiến độ nâng cấp trợ lý cá nhân (cập nhật 2026-11-19)

## Đã xong (đã merge vào main)
| PR | Nội dung |
|---|---|
| #4 | Thông báo cập nhật (Bỏ qua / Để sau, bản critical, kênh beta, sao lưu DB) |
| #5 | Điều khiển máy tính — CHỈ XEM, phím dừng khẩn cấp Ctrl+Alt+Q |
| #6 | Đọc log Unity/Blender; cửa sổ + cây UI qua Python sidecar (uv) |
| #7 | Dán / kéo thả ảnh vào chat |
| #8 | Kết nối agent: Mizuki làm MCP server cho Claude Code/Desktop + dùng MCP server khác |
| #10 | GĐ 3 — Chat biểu cảm: emoji, GIF/sticker GIPHY, sticker trên máy, thả cảm xúc, mức biểu cảm (có Tự động) |
| #11 | GĐ 2 — Giọng nói: faster-whisper (GPU/CPU), edge-tts + Piper, đọc to từng câu, ngắt lời |
| #12 | GĐ 5 — Artifacts: panel sandbox, doc / slides / sheet / chart / mermaid / html, phiên bản, xuất docx/pdf/pptx/xlsx/csv/json/svg, mẫu làm game |
| #13 | Cài skill cho Mizuki (thư mục / .zip, tự chọn theo câu hỏi, my-style) |
| #14 | GĐ 4 — Gmail & Telegram chỉ đọc + soạn nháp (mặc định tắt) |
| #15 | Gmail nhiều tài khoản (một OAuth client, token riêng từng tài khoản, tên gọi, nháp đúng tài khoản) |
| #16 | Đồng bộ trạng thái toàn app (`sync:changed` + `useSync` + `optimistic`) |
| #17 | Sắp xếp cuộc trò chuyện (ghim, nhóm, gợi ý nhóm, nhánh, tiêu đề tự động, tìm kiếm) — phát hành 0.4.0-beta.1 |
| #18 | Thanh trên khung chat, tab Gần đây trong bộ chọn emoji, đề xuất trí nhớ dạng danh sách gọn — 0.4.0 |
| #19 | Quyền thư mục ở mọi chế độ + trợ lý tự xin quyền + hồ sơ dự án |
| #20 | Trả lời một tin, ghim tin, thu hồi, sửa & gửi lại |
| #21 | Sửa menu ⋮ trên tin bị trong suốt — phát hành 0.5.0 |
| #22 | Đợt "giống Claude" PR 1: gộp lời gọi công cụ thành một dòng + gom "Những điều đã ghi nhớ" theo loại |

## Ghi chú chi tiết các PR gần đây (đều đã merge)
- **`fix/beta2-toolbar-emoji-recent`** (cho 0.4.0-beta.2) — 3 việc:
  1. **Thanh trên khung chat:** nút Artifacts bỏ định vị tuyệt đối, vào chung thanh flex với tiêu đề + Gợi ý ghi nhớ; khung hẹp (container query, < 42rem) chỉ còn biểu tượng + tooltip; tiêu đề dài cắt bằng …. E2E `chat-header.spec.ts` đo khung ở 900 / 1100 / 1280px và khi mở panel Artifacts (ảnh `test-results/chat-header-*.png`).
  2. **Tab 🕘 Gần đây trong bộ chọn emoji:** tối đa 40 emoji, mới dùng xếp đầu; đầy thì loại mục có điểm thấp nhất (số lần dùng × ½ mỗi 7 ngày không dùng) → emoji hay dùng giữ lâu hơn. Mở bộ chọn: có gần đây → tab Gần đây, chưa có → mặt cười (chỉ chọn lúc mở, chọn emoji không làm tab nhảy). Bỏ dòng "Dùng gần đây" ở tab mặt cười. Tính: chọn trong bộ chọn (ngay), gõ thẳng trong tin (lúc gửi, trừ cái đã chọn để không tính trùng), thả cảm xúc (main). GIF / sticker: dải "Gần đây" riêng (18 mục mỗi loại), main ghi khi gửi. "Xoá gần đây" bấm hai lần (4 giây). Lưu settings `expressiveRecent` trên máy, sync mục `expressiveRecent`; emoji cũ trong localStorage chuyển sang một lần.
  3. **Đề xuất chờ duyệt (trang Trí nhớ):** mục thu gọn được (bấm tiêu đề, có số, nhớ trạng thái — localStorage vì chỉ là cách xem); dòng gọn một dòng + nhãn loại + ✓ / ✕, bấm dòng mở ô sửa tự giãn (`field-sizing: content`, không thanh cuộn); 5 dòng đầu + "Xem thêm N"; lọc theo loại; tick / Chọn tất cả → Đồng ý / Bỏ qua đã chọn (IPC `memory:resolveMany`, bỏ qua đề xuất đã duyệt nơi khác); "Đồng ý tất cả" bấm hai lần. Duyệt lạc quan, sync mục `memory`. E2E `memory-suggestions.spec.ts` (FakeChat `FAKE_MEMORIES:<n>`).
  - Kèm: sửa e2e `update.spec.ts` ghi cứng "0.3.0" (hỏng từ khi nâng lên 0.4.0-beta.1) → đọc từ package.json.
- **`feat/folder-access`** (#19, đã merge) — team góp ý: trợ lý ở chế độ Tự do bảo người dùng copy-dán code thay vì tự đọc. Nguyên nhân: quyền thư mục chỉ có ở chế độ Code. Sửa:
  1. **Thư mục gắn với cuộc trò chuyện, không gắn với chế độ:** mọi chế độ có thư mục → Read/Grep/Glob (chỉ đọc) hoặc thêm Edit/Write (duyệt diff từng lần). Thanh thư mục hiện ở chế độ Code, hoặc ở chế độ khác khi đã có thư mục; nút **Gỡ thư mục** = thu hồi quyền (IPC `code:clearFolder`).
  2. **Trợ lý tự xin quyền:** tool app `request_folder_access` (path gợi ý, write, reason) — chỉ có khi chưa có thư mục / chỉ đọc. Thẻ "Trợ lý xin quyền…" → người dùng bấm *Chọn thư mục…* (hộp thoại Windows, gợi ý sẵn path) → quyền chỉ có khi người dùng TỰ chọn (path trợ lý đưa không bao giờ tự cấp). Huỷ hộp thoại → thẻ vẫn chờ; dừng lượt / 10 phút → từ chối. Tool CLI cố định theo lượt → cấp xong renderer tự gửi "Mình đã cấp quyền thư mục rồi, bạn tiếp tục nhé." khi lượt kết thúc (chỉ khi vẫn đang mở cuộc đó).
  3. **Hồ sơ dự án** (`src/main/code/projectProfile.ts`): Unity (chặn `Library/`, `Temp/`, `Logs/`, `obj/`, `Build(s)/`, `UserSettings/`, `.meta`), Blender, DaVinci, Node; mọi dự án chặn `.git/`, `node_modules/` và file nhị phân (`.blend`, `.drp`, ảnh, âm thanh, video, dll…). Lưu ý theo loại dự án đưa vào ngữ cảnh. Thêm phần mềm mới = thêm một mục `PROFILES`.
  - Test: `src/main/code/__tests__/folderAccess.test.ts`, `chatService.test.ts`; e2e `folder-access.spec.ts` (`MMC_FAKE_FOLDER` = hộp chọn thư mục giả, chỉ bản chưa đóng gói).

- **`feat/message-reply-pin-recall`** (#20) — góp ý của team (kiểu Messenger). Menu ⋮ trên mỗi tin (mở lên, gần mép trên thì mở xuống):
  1. **Trả lời một tin:** cột `messages.reply_to_id` (migration `0011_message_reply_pin_recall`); khung "Đang trả lời …" trên ô nhập (bỏ bằng ✕), khối trích dẫn trên tin đã gửi (bấm → cuộn tới tin gốc và nháy nền; tin gốc mất → "Tin gốc không còn"). Prompt gửi trợ lý thêm dòng `[Người dùng đang trả lời …: "<trích ≤400 ký tự>"]`. Chỉ tin cùng hội thoại, chưa thu hồi; GIF / giọng nói gửi như tin thường.
  2. **Ghim tin:** `pinned_at`, tối đa 5 tin mỗi cuộc (`pin_limit`); thanh "tin đã ghim" dưới tiêu đề (1 tin + "+N tin đã ghim khác"), bấm → cuộn tới, ✕ bỏ ghim; dấu 📌 trên tin. Ghim lạc quan (lỗi → hoàn tác + báo).
  3. **Thu hồi** (chỉ tin của người dùng, không khi đang trả lời, bấm hai lần): `recalled_at`, xoá chữ / file / GIF / giọng nói, bỏ ghim; không vào lịch sử gửi trợ lý; lượt sau nhắc trợ lý bỏ qua tin đó (session CLI có thể đã đọc).
  4. **Sửa & gửi lại** (tin chữ của người dùng): xoá tin đó + mọi tin sau, bỏ session CLI, lượt mới gửi kèm lịch sử còn lại (cờ `rebuildNext`, chỉ cho lượt này).
  - IPC `chat:pin` / `chat:recall` / `chat:editResend` báo sync mục mới `messages` → cuộc đang mở tải lại tin (bỏ qua khi đang stream).
  - Test: `chatService.test.ts` (5 test mới); e2e `message-actions.spec.ts`.

## Đợt "giống Claude" (bắt đầu 2026-11-19, yêu cầu trong `script-update-agent.md`)
| PR | Nội dung | Migration | Quyền mới cho trợ lý |
|---|---|---|---|
| 1 | Thu gọn lời gọi công cụ trong chat + gom nhóm / thu gọn "Những điều đã ghi nhớ" | — | — |
| 1b | Thẻ duyệt nằm trong khung chat + **Hỏi lại** + **Từ chối kèm góp ý** (sửa file, xin quyền thư mục, nháp Gmail/Telegram) | — | Không (câu trả lời giải thích không có tool) |
| 2 | Thanh bên mới (Mới · Tìm kiếm · Dự án · Artifacts · Lịch hẹn · Plugin, Đã ghim, nhóm, Gần đây, avatar + cài đặt ở đáy) + trang Artifacts + trang "Sắp có" | — | — |
| 3 | Ô tìm kiếm nổi (Ctrl+K), tab lọc, xem trước artifact, dùng lại FTS | — | — |
| 4 | Cài đặt thành cửa sổ nổi, có ô tìm (không dấu) | — | — |
| 5 | Dự án (hướng dẫn, ngữ cảnh, trí nhớ riêng, lịch hẹn) | SQLite | Hướng dẫn / ngữ cảnh dự án vào prompt; trí nhớ dự án vẫn qua duyệt |
| 6 | Trang Plugin (đã cài + gợi ý) | — | — |
| 7 | Lịch hẹn — gửi thiết kế riêng, chờ duyệt | SQLite | Có (chạy khi không có người) |
| 8 | Kho plugin online — gửi thiết kế riêng, chờ duyệt | có thể | Có (nội dung từ Internet, MCP) |

Quyết định đã duyệt (2026-11-19):
- **Thanh biểu tượng mảnh bên trái giữ lại** (các tính năng team / cá nhân), thanh bên mới thuộc trang Chat và **thu gọn được**. Một mục chỉ ở MỘT chỗ — vd Plugin, Artifacts chỉ ở thanh bên mới; mục nào chuyển sang thanh bên mới thì bỏ khỏi thanh biểu tượng.
- **Tên:** dự án chat = "Dự án"; dự án team trong Công việc đổi chữ hiển thị thành "Dự án team" (chỉ đổi chữ, không đổi dữ liệu / route).
- **Hỏi lại (1b):** gọi Claude một lần riêng, cùng model đang chat, KHÔNG tool, không resume session, kèm diff + ~10 tin gần nhất + các câu hỏi trước → lượt CLI đang chờ duyệt không bị đụng; mỗi câu trả lời tính lại hạn 10 phút. **Từ chối kèm góp ý:** trả `{ allow: false, message: <góp ý> }` cho lượt đang chờ → Claude tự đề xuất bản sửa mới trong cùng lượt (lại qua thẻ duyệt), không tốn thêm lần gọi.
- Trạng thái thu gọn (nhóm trí nhớ, danh sách công cụ) chỉ là cách xem → localStorage / state cục bộ, không vào DB.

Tiến độ:
- **PR 1 — #22 `feat/collapse-tools-memory`** (đã merge 2026-11-19, CI xanh):
  - **Công cụ:** `ToolEvents.tsx` gộp mọi lời gọi công cụ của một tin thành một dòng, mặc định thu gọn ("Đã dùng 9 công cụ · Read ×5, Grep ×4", tối đa 3 loại rồi "…"; một công cụ vẫn là "Đã dùng công cụ X"). Bấm → danh sách từng lần kèm file / từ khoá / lệnh (`toolSummary.ts`). Đang chạy (đang stream và chữ chưa dài thêm từ lúc nhận công cụ cuối) → "Đang đọc file…" + file đang đọc. MCP ngoài hiện "server · tool". Thẻ duyệt là hộp thoại riêng nên không bị gộp.
  - **Trí nhớ:** gom theo loại (Sở thích trả lời, Dự án, Mục tiêu, Kỹ năng, Deadline, Khác), tiêu đề + số, bấm thu / mở (localStorage `mmc.memory.collapsed.group.<loại>`); 5 mục + "Xem thêm N"; mục dài một dòng + "Xem thêm" / "Thu gọn" (chỉ hiện khi bị cắt thật). Đang tìm: nhóm có kết quả tự mở, thu gọn chỉ tạm thời; xoá ô tìm → về trạng thái đã lưu. Bỏ nhãn loại trên từng dòng (đã có tiêu đề nhóm).
  - Test: `toolSummary.test.ts`, `groupMemories.test.ts`; e2e `collapse.spec.ts` (FakeChat `FAKE_TOOLS:<n>`, ảnh sáng / tối 900 / 1280px trong `test-results/`).
  - Chưa thử với Claude thật: dòng "Đang …" khi CLI gọi công cụ xen giữa đoạn chữ.
- **Tiếp theo: PR 1b** — thẻ duyệt vào khung chat + Hỏi lại + Từ chối kèm góp ý.
- **Repo:** `main` dùng Repository ruleset bắt buộc 1 review duyệt; Admin đã nằm trong bypass list (2026-11-19) → merge khi không có người review dùng `gh pr merge <số> --merge --admin` (chỉ khi người dùng bảo merge). Repo đã chuyển sang `MMC-Studio/MMC-Studio-team-working`.

## Việc tiếp theo
1. Test tay với Claude thật: #19 (chế độ Tự do, nhắc đường dẫn dự án Unity → thẻ xin quyền) và #20 (trả lời một câu cũ của trợ lý xem nó có hiểu đúng ngữ cảnh không).
2. Các mức quyền sau (để sẵn khung, chưa làm): "sửa không hỏi lại suốt phiên"; chạy lệnh theo danh sách cho phép (build Unity batchmode, `blender --background --python`, git status) — vẫn phải hỏi; thêm thư mục phụ; trang Cài đặt liệt kê quyền đang cấp + nhật ký thao tác; "thư mục gần đây" nếu team thấy phải cấp lại nhiều lần.
3. Để sau: thao tác chuột/bàn phím (chỉ khi người dùng đồng ý riêng); A2A + mở kết nối ra LAN (chỉ có đề xuất trong `docs/agents.md`).

## Quyết định đã duyệt
- **Quyền thư mục:** theo mức (chưa có → đọc → sửa có duyệt → [sau] sửa cả phiên → [sau] chạy lệnh theo danh sách cho phép → [sau] thư mục phụ). Trợ lý không tự nâng quyền — chỉ xin, người dùng chọn thư mục. Quyền lưu theo cuộc trò chuyện. Không bao giờ: ngoài thư mục đã chọn, cài đặt hệ thống, lệnh xoá hàng loạt.
- **Chung:** tính năng cá nhân mặc định TẮT với thành viên team; không hard-code máy/tài khoản ai (repo public) — người dùng tự bật trong Cài đặt. Mỗi người tự tạo key/OAuth. Secret chỉ trên máy (DPAPI), không vào repo. Thư viện nặng chỉ tải khi bật.
- **Điều khiển máy tính:** cảnh báo khi bật lần đầu; không có Ctrl+Alt+Q thì không bật; mặc định chỉ xem.
- **Python sidecar:** uv, cài vào thư mục dữ liệu app; thư viện khoá hash, `--no-build`.
- **Kết nối agent:** duyệt lần đầu (trả `not_approved` ngay), thu hồi được; trả lời agent khác không tool, không trí nhớ, không biểu cảm / artifact; 20 yêu cầu/giờ, 1 việc cùng lúc; MCP client duyệt từng lần gọi tool.
- **Biểu cảm:** GIPHY (key trong .env cho dev / ô nhập DPAPI); thẻ `[[react|gif|sticker:…]]` chỉ chứa từ khoá, không URL; tối đa 1 GIF/sticker + 1 reaction mỗi câu; hỏi lỗi kỹ thuật → tối đa 2 emoji; mức Tắt/Ít/Vừa/Nhiều/Tự động (độ thân thiết tính trên máy).
- **Giọng nói:** STT faster-whisper — GPU + CUDA → large-v3-turbo, không thì small/CPU, chỉ lùi về CPU khi lỗi GPU thật; không khoá ngôn ngữ; tự giải mã WAV (không qua `av.open`, khoá av 14.2). TTS Edge, lỗi thì Piper. "Nói xong" mặc định điền ô nhập. Ghi âm gốc giữ 7 ngày trên máy. Yêu cầu hành động từ chữ chép lời → hỏi xác nhận.
- **Artifacts:** `<artifact>` tạo / viết lại, `<artifact-edit>` find/replace (khớp đúng một chỗ, không thì báo lỗi). iframe CHỈ `allow-scripts`, origin `mmc-artifact://`, CSP chặn mạng, thư viện đóng gói sẵn, postMessage lệnh cố định. Công thức bảng không dùng eval. Slide Markdown → pptx sửa được; theme mở rộng được (JSON, sau này từ skill).
- **Skill:** SKILL.md kiểu Claude, lưu `%APPDATA%/Team Working/skills`; chỉ giữ .md/.txt/.json (script, nhị phân bị bỏ — không bao giờ chạy); ≤100 file, 2 MB; chặn zip-slip; trùng tên skill có sẵn → từ chối. Xem trước (nguồn + nội dung + file bị bỏ) rồi mới cài. Mỗi câu: my-style + skill gọi đích danh (≤3) + tối đa 2 skill tự chọn theo description (điểm ≥3), phần skill ≤5000 ký tự; skill khác chỉ liệt kê tên. my-style: trợ lý đề xuất, người dùng chọn/sửa rồi mới lưu.
- **Gmail / Telegram (GĐ 4):** chỉ đọc + soạn nháp, không có hàm gửi; mọi nháp qua hộp duyệt (sửa được, 10 phút không trả lời = từ chối). Mỗi người tự tạo OAuth client Desktop / api_id; secret + token + session DPAPI. Gmail: PKCE + state qua loopback 47823, scope readonly + compose, REST bằng fetch; Testing hết hạn 7 ngày → `expired`, trợ lý chỉ nhận lời nhắc kết nối lại; ẩn thư nhạy cảm (mặc định bật) + chặn người gửi/tên miền. Telegram: GramJS nạp động, allowlist mặc định (rỗng), blocklist tự chặn chat nhạy cảm, 777000 luôn chặn; danh sách chat cache 15 phút, Làm mới ≤1 lần/phút, không đồng bộ nền; FLOOD_WAIT báo lại, không ngủ. 60 lần gọi tool/giờ: Telegram và từng tài khoản Gmail riêng.
- **Đồng bộ trạng thái (thay `useRefreshOnFocus`):** mọi IPC đổi trạng thái khai báo `{ changes }` → luôn báo `sync:changed` (kể cả lỗi); ghi settings tự báo theo khoá; trang dùng `useSync` / `useSyncedState` (mở + focus + sự kiện), thao tác qua `optimistic` (hoàn tác + báo lỗi; trong lúc lưu hoãn hỏi lại mục đó). Không làm mới theo chu kỳ. Quy tắc trong CLAUDE.md.
- **Sắp xếp cuộc trò chuyện:** lưu trên máy (bảng `conversation_groups`, cột `group_id` / `parent_id` / `title_source` / `suggested_group_id`), theo tài khoản như lịch sử chat. Tên nhóm không trùng (so không dấu). Gợi ý nhóm: so khớp từ khoá trước (tên nhóm nguyên cụm +4, từng từ +2, từ trùng tiêu đề cuộc trong nhóm +1 tối đa 3; ≥3 điểm, không hoà); không ra thì gộp vào MỘT lần gọi Haiku cùng việc đặt tiêu đề (sau lượt trả lời đầu, chỉ một lần mỗi cuộc). Gợi ý chỉ chọn nhóm có sẵn, người dùng bấm đồng ý mới chuyển. Đổi tên tay → `title_source = user`, AI không đặt lại. Nhánh: chép tin tới tin được chọn (bỏ thẻ artifact vì artifact thuộc cuộc gốc), cùng chế độ / thư mục / nhóm; lượt đầu không có session CLI → gửi kèm lịch sử; xoá gốc → nhánh thành cuộc thường. Tìm kiếm: khớp tiêu đề / tên nhóm / nội dung tin (FTS); chỉ khớp nội dung → kèm trích đoạn (FTS snippet, dấu đánh dấu /, bỏ Markdown). Đang tìm: nhóm có kết quả tự mở, thu gọn chỉ tạm thời (không lưu), xoá ô tìm → về trạng thái đã lưu. Kéo vào Đã ghim = ghim (giữ nhóm); kéo vào nhóm / chưa xếp nhóm = chuyển + bỏ ghim. Model rẻ: CLI `--model haiku`, API `claude-haiku-5-5` effort low (không có server-side fallback). Tắt được trong Cài đặt → AI.
- **Gmail nhiều tài khoản:** một OAuth client dùng chung; mỗi tài khoản token riêng, tên gọi riêng (không trùng, so không dấu), bật/tắt cho trợ lý + chặn người gửi + ẩn thư nhạy cảm riêng. Ngắt kết nối = bỏ khỏi danh sách. id thư cho trợ lý = `<tài khoản>:<id thư>` → nháp trả lời luôn vào tài khoản chứa thư gốc; thư mới nhiều tài khoản → trợ lý phải hỏi. Kết nối lại dùng `login_hint`, đăng nhập nhầm tài khoản → từ chối. Bản cũ chuyển thành tài khoản `primary` dùng lại `gmail-refresh-token.bin`.
