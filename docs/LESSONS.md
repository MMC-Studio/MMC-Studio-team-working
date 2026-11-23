# Bài học & lỗi đã gặp — đọc trước khi thêm tính năng

File này ghi lại những lỗi team đã gặp khi làm MMC studio, để người làm sau (người hay AI) không vấp lại.
Mỗi mục: **Quy tắc** (phải làm gì) → **Vì sao** → **Mẫu có sẵn trong repo**.

---

## 0. Tự rút kinh nghiệm — ghi bài học mới vào file này

File này **tự lớn lên theo thời gian**. Người hoặc AI sửa lỗi xong thì tự ghi bài học vào đây, không cần ai nhắc.

**Khi nào PHẢI ghi** (một trong các trường hợp):

- Lỗi bị phát hiện khi **test tay**, do **team góp ý**, hoặc lọt tới người dùng — tức là test tự động đã không bắt được.
- Mất nhiều thời gian tìm nguyên nhân, hoặc nguyên nhân thật khác hẳn giả thuyết ban đầu.
- Lỗi về **an toàn / quyền** (lọt ra ngoài thư mục, lộ token, trợ lý tự nâng quyền…).
- Lỗi do đặc thù Windows / Electron / Claude CLI mà người mới dễ không biết.
- Cùng một kiểu lỗi xuất hiện lần thứ hai.

**Khi nào KHÔNG ghi:** lỗi gõ nhầm, lỗi lint / typecheck, lỗi chỉ có ở một chỗ và không lặp lại được ở tính năng khác.

**Cách ghi:**

- Ghi **trong cùng PR sửa lỗi** (không để "ghi sau").
- Đọc file trước: đã có mục tương tự → **bổ sung vào mục đó** (thêm số PR, ví dụ mới) thay vì tạo mục trùng.
- Đặt vào phần phù hợp (Trải nghiệm / Quyền & an toàn / Windows / Test tay…), chưa có thì tạo phần mới.
- Viết **quy tắc chung** để tránh cả loại lỗi đó, không chỉ kể lại lỗi cụ thể. Giữ ngắn: **Quy tắc** → **Vì sao** (kèm số PR) → **Mẫu có sẵn** nếu có.
- Không ghi secret, token, đường dẫn hay tên tài khoản trên máy ai (repo public).
- Trong báo cáo cuối PR, nói rõ "đã thêm bài học X vào docs/LESSONS.md" để chủ repo duyệt.

---

## 1. Trải nghiệm người dùng

### 1.1. Mọi thứ người dùng đang nhập dở đều phải có bản nháp

**Quy tắc.** Bất kỳ chỗ nào người dùng nhập hoặc soạn nội dung — tin nhắn chat, tạo / sửa file, dự án, lịch hẹn, form cài đặt, nháp Gmail / Telegram, skill, MCP server, hay tính năng mới sau này — đều phải tự lưu bản nháp (hoặc file lưu tạm) để:

- lỡ bấm sang trang khác, đổi cuộc trò chuyện, đóng hộp thoại, hoặc làm việc khác xong quay lại → **vẫn còn nguyên nội dung đang làm dở**;
- tắt app / app bị crash rồi mở lại → vẫn còn;
- người dùng **không bao giờ phải làm lại từ đầu**.

**Cách làm (checklist khi thêm tính năng mới):**

- [ ] Nháp gắn với **đúng đối tượng** (theo id cuộc trò chuyện / dự án / lịch…), không dùng chung một nháp cho mọi thứ.
- [ ] Tự lưu khi gõ (debounce khoảng 300–500 ms) — không bắt người dùng bấm "Lưu nháp".
- [ ] Mở lại đúng chỗ đó → tự điền lại nháp (kể cả file đính kèm, lựa chọn trong form nếu có).
- [ ] **Chỉ xoá nháp khi đã gửi / lưu THÀNH CÔNG.** Gửi lỗi → giữ nguyên nháp.
- [ ] Bấm "Huỷ" / "Bỏ" khi nháp có nội dung → hỏi xác nhận (hoặc bấm hai lần), không xoá im lặng.
- [ ] Nháp lưu trên máy, theo tài khoản như dữ liệu khác. Không gửi nháp lên server / Supabase.
- [ ] Đối tượng bị xoá → xoá nháp của nó theo. Nháp quá cũ có thể dọn tự động (ghi rõ thời hạn).
- [ ] Có e2e: gõ dở → chuyển trang / đổi cuộc → quay lại → nội dung còn nguyên; gửi lỗi → nháp còn.

**Vì sao.** Team góp ý nhiều lần: đang soạn dở bấm nhầm ra ngoài là mất hết, phải gõ lại. Đây là lỗi làm người dùng bực nhất mà sửa lại rẻ nhất nếu làm ngay từ đầu.

**Mẫu có sẵn.** Nháp tin nhắn theo từng cuộc trò chuyện (#39): `src/renderer/src/features/chat/drafts.ts`, `draft.ts` và test `features/chat/__tests__/drafts.test.ts`. Tính năng mới nên dùng lại cách làm này thay vì tự viết kiểu khác.

### 1.2. Trên một trang, mỗi lúc chỉ mở một form cho một việc

**Quy tắc.** Khi người dùng chuyển từ việc này sang việc khác trên cùng trang (vd "Thêm server" → "Nhập token"), trạng thái form cũ phải được đóng / dựng lại. Không để hai form cùng mở cạnh nhau.

**Vì sao.** Trang MCP server từng mở cùng lúc form "Thêm server thủ công" và form nhập token → người dùng điền token nhầm vào form thêm mới (#45).

### 1.3. Thêm trạng thái "đã khép" cho thẻ → mọi dòng con phải theo

**Quy tắc.** Khi thêm một trạng thái làm thẻ hết duyệt được (thu hồi, hết hạn, đã yêu cầu sửa…), rà mọi nhãn **bên trong** thẻ (từng file, từng nháp, nút, bộ đếm): nhãn con tính từ trạng thái thẻ cha, không chỉ từ trạng thái riêng của dòng. Dòng "chờ duyệt" trong thẻ đã khép phải đổi thành nhãn đúng (vd "không ghi"). Test kiểm cả nhãn con, không chỉ nhãn của thẻ.

**Vì sao.** #52 thêm trạng thái `revoked` cho thẻ hoãn duyệt: tiêu đề thẻ ghi "Đã thu hồi…" nhưng từng file bên trong vẫn "chờ duyệt" (thẻ hết hạn cũng bị y vậy từ trước) — phát hiện khi test tay.

**Mẫu có sẵn.** `FileRow` trong `src/renderer/src/features/schedules/components/DeferredCards.tsx` (`shown = !open && pending ? 'closed' : status`); e2e "thu hồi quyền của lịch" trong `tests/e2e/schedules-deferred.spec.ts`.

### 1.4. Hai component anh em cùng `key` → React vẽ lặp, bố cục vỡ theo kiểu khó đoán

**Quy tắc.** Dùng `key={id}` để "đổi cuộc là dựng lại" thì thêm tiền tố riêng cho từng component (`` key={`auto-edits-${id}`} ``) khi chúng là con trực tiếp của **cùng một phần tử cha** — key chỉ cần khác nhau giữa anh em. Gặp lỗi "bị che / không bấm được" trên trang chat: đo kích thước khung cuộn trước khi sửa CSS.

**Vì sao.** PR C thêm băng tự duyệt cạnh `ChatHeader` với cùng `key={activeId}` → `ChatHeader` bị vẽ lặp hàng chục lần, khung tin nhắn còn cao 0 px; e2e báo "thanh thư mục chặn nút bấm" — trông như lỗi chồng lớp, nguyên nhân thật là trùng key (cảnh báo của React không hiện trong e2e).

---

## 2. Quyền & an toàn

### 2.1. Kiểm "trong thư mục" theo đường dẫn THẬT, không theo chuỗi

**Quy tắc.** Mọi kiểm tra "file này có nằm trong thư mục người dùng đã chọn không" phải dùng đường dẫn thật (`realpath`, sau khi đi qua symlink / junction), không chỉ so chuỗi đường dẫn.

**Vì sao.** Một junction trong thư mục dự án có thể trỏ ra ngoài; so chuỗi thì vẫn "nằm trong" → lọt (#47).

### 2.2. Phát hiện OAuth: đừng chỉ dựa vào mã 401

**Quy tắc.** Chỉ coi một MCP server là "cần OAuth" khi trả 401/403 **kèm** `WWW-Authenticate: Bearer … resource_metadata=…`. 401 trơn → cảnh báo "có thể cần đăng nhập" nhưng vẫn cho thử.

**Vì sao.** Cùng một server có địa chỉ cho dùng ẩn danh và địa chỉ đòi đăng nhập; chặn theo mỗi status dễ chặn nhầm (#44).

### 2.3. Quyền mới cho trợ lý: luôn qua bước người dùng duyệt

Xem mục "Quyết định đã duyệt" trong `docs/PROGRESS.md`. Tóm tắt: trợ lý chỉ đề xuất / xin, người dùng tự chọn; mặc định TẮT với thành viên team; không có "luôn cho phép" cho thứ đến từ bên ngoài (server từ kho, lệnh chạy code).

### 2.4. Lệnh "chỉ đọc" trong thư mục lạ vẫn có thể chạy code của thư mục đó

**Quy tắc.** Trước khi cho trợ lý chạy một chương trình trong thư mục người dùng chọn, tìm xem chương trình đó đọc cấu hình gì **từ chính thư mục** và cấu hình đó có gọi được chương trình khác không — rồi vô hiệu từng đường, và có test đối chứng (chạy thẳng thì CÓ chạy code, qua app thì KHÔNG). Luôn gọi chương trình bằng đường dẫn tuyệt đối, không qua shell, allowlist cả tham số (không chỉ tên lệnh con).

**Vì sao.** Đo thật với git 2.56: `git status` / `git diff` trong repo lạ chạy được chương trình qua `core.fsmonitor`, filter `clean` / `smudge`, `diff.<driver>.command`, `textconv` (khai trong `.git/config` + `.gitattributes`). `--attr-source=<cây rỗng>` chặn `.gitattributes` nhưng **không** chặn `.git/info/attributes` → phải ghi đè thêm mọi khoá driver đọc từ `git config --list --includes`. Unity / Blender (A2) cũng vậy: `-executeMethod`, `--python` là chạy code tuỳ ý (#49).

**Mẫu có sẵn.** `src/main/commands/gitEnv.ts` (`safetyArgs`, `driverOverrides`, `findGit`), `gitPolicy.ts` (allowlist tham số), test đối chứng trong `src/main/commands/__tests__/service.test.ts`.

### 2.5. Nhật ký / trạng thái quyền: tách rõ "người dùng bấm" với "app tự làm"

**Quy tắc.** Mỗi hành động khác nhau của người dùng (Đồng ý một lần, **Luôn cho phép**, Từ chối…) và mỗi việc app tự làm không ai bấm (tự duyệt, chặn, hết hạn) phải là **một giá trị riêng** trong trường kết cục — không gộp vào "đồng ý" rồi giấu khác biệt trong cột phụ (`detail`). Nhãn hiển thị của việc app tự làm phải khác cả chữ lẫn màu với nhãn người dùng bấm. Test kiểm **chữ nhãn + giá trị** của từng trường hợp, không chỉ đếm số dòng.

**Vì sao.** Nhật ký #51 lần đầu ghi bấm "Luôn cho phép" thành "Đồng ý" (khác biệt nằm trong `detail`), còn lần trợ lý tự chạy không thẻ lại hiện "Luôn cho phép" — người đọc nhật ký hiểu ngược ai đã quyết định. Test chỉ đếm 3 dòng MCP nên không bắt được; phát hiện khi test tay.

**Mẫu có sẵn.** `ACTION_LOG_DECISIONS` trong `src/shared/actionLog.ts` (`always` ≠ `approved`, `auto` = "Tự duyệt", màu tím viền đứt), e2e `tests/e2e/action-log.spec.ts` (kiểm chữ + `data-decision` + màu khác nhau).

### 2.6. Bỏ bước hỏi (tự duyệt): liệt kê mọi đường "file → chạy code" và mọi cách một file "là" file khác

**Quy tắc.** Trước khi cho một thao tác đi qua không thẻ, hỏi: (1) phần mềm nào trên máy sẽ **tự đọc và chạy** file này (Editor tự biên dịch, hook, task, cấu hình build / CI / gói)? — những file đó luôn phải hỏi, xét theo cả đường dẫn chữ lẫn đường dẫn thật, và theo dấu hiệu ở MỌI cấp thư mục (dự án nằm trong thư mục con); (2) file có đang là **chỗ khác** không — realpath giải symlink / junction nhưng **không** giải hard link (`nlink > 1` → phải hỏi); (3) luật so sánh ("ngắn đi quá ½") so với bản **đầu phiên**, không phải lần sửa trước — không thì cắt dần từng chút là lọt. Không tách được nhóm an toàn khỏi nhóm nguy hiểm → coi cả nhóm là nguy hiểm.

**Vì sao.** Kế hoạch C ban đầu chỉ chặn script / `package.json` / `.env`; người dùng góp ý khi duyệt: Unity Editor đang mở tự biên dịch mọi `.cs` và chạy `[InitializeOnLoad]` (cả script ngoài `Editor/` bọc `#if UNITY_EDITOR`) → tự duyệt `.cs` = chạy code không qua thẻ; hard link qua mặt bước kiểm realpath; "ngắn hơn ½" so với lần trước thì cắt nhiều lần là xoá được cả file (PR C).

**Mẫu có sẵn.** `askAlwaysReason` trong `src/main/code/projectProfile.ts` (`askAlways` theo hồ sơ dự án + luật chung), `AutoEdits.offer` trong `src/main/code/autoEdits.ts`; test từng file trong `src/main/code/__tests__/autoEdits.test.ts`.

### 2.7. App tự mô phỏng việc CLI sắp làm → phải mô phỏng ĐÚNG như CLI (xuống dòng, chuẩn hoá…)

**Quy tắc.** Khi app tự áp thử thao tác của CLI (Edit để làm diff / kiểm / tính hash cho hoàn tác), làm theo đúng quy tắc của CLI, nhất là xuống dòng: Edit của Claude Code so khớp trên bản đã đổi CRLF → LF và ghi lại theo kiểu xuống dòng của file. Kiểm của app chặt hơn CLI = chặn nhầm; lỏng hơn = duyệt thứ CLI sẽ làm khác. Hash "bản đã duyệt" chấp nhận cả biến thể LF / CRLF. Test luôn có một file CRLF (máy dùng Windows). Dòng "App chặn" trong nhật ký phải hiện lý do (cột `detail`), và đường dẫn trong thư mục ghi dạng tương đối như các dòng khác của cùng file.

**Vì sao.** Test tay PR C: nhật ký có "App chặn" cho `…\hoc\ngan.txt` rồi ngay sau đó sửa lại tự duyệt được. Tưởng lỗi đường dẫn (tuyệt đối / hoa thường / dấu); thật ra file CRLF, lần sửa trước chèn dòng mới (CLI ghi CRLF), lần sau `old_string` có `\n` → app so từng byte nên báo `old_string_not_found` (CLI thì khớp). DB máy dev có 8 dòng như vậy từ trước; trang nhật ký không hiện lý do nên không ai thấy.

**Mẫu có sẵn.** `applyTool` / `usesCrlf` / `otherLineEnding` trong `src/main/code/change.ts`; `blockedReason` trong `ActionLogSection.tsx`; test CRLF trong `src/main/code/__tests__/change.test.ts` và `autoEdits.test.ts`.

---

## 3. Windows

### 3.1. Thư mục đang mở thì không đổi tên được

**Quy tắc.** Thay thư mục bằng cách đổi tên phải có đường lùi khi gặp `EPERM` / `EBUSY` / `EACCES` (vd ghi đè từng file tại chỗ), và báo lỗi kèm **lý do + tên file**, không chỉ mã chung.

**Vì sao.** Thư mục đang mở trong Explorer / trình soạn thảo / cửa sổ lệnh thì Windows không cho đổi tên → "Cài lại" plugin hỏng (#40).

### 3.2. Xoá junction đúng cách

Dùng `cmd /c rmdir <junction>`. **Không** dùng `Remove-Item -Recurse` lên junction — có thể xoá lan sang thư mục đích.

### 3.3. Dừng chương trình ngoài: dừng CẢ CÂY, và test bằng tiến trình con không dính vào cha

**Quy tắc.** Dừng một chương trình ngoài (Unity, Blender…) khi hết hạn / bấm Dừng / Ctrl+Alt+Q phải dừng cả cây tiến trình (`taskkill /PID <pid> /T /F`), không chỉ `child.kill()`. Test việc này bằng tiến trình giả viết bằng node thì tiến trình con giả phải chạy `detached: true` — và chạy **kiểm thử ngược** (tạm bỏ `/T`, test phải đỏ) trước khi tin test.

**Vì sao.** Unity sinh tiến trình con (biên dịch shader, licensing…); `child.kill()` trên Windows chỉ giết tiến trình cha. Lần đầu test A2 vẫn xanh dù bỏ `/T`: node (libuv) cho mọi tiến trình con vào một job object tự huỷ khi node chết, nên con của tiến trình giả chết theo cha — điều không xảy ra với Unity thật. Thêm `detached` (con nằm ngoài job object) thì kiểm thử ngược mới đỏ đúng.

**Mẫu có sẵn.** `killTree` trong `src/main/commands/apps/runner.ts`; tiến trình giả `tests/e2e/fixtures/fake-app.cjs` (`sleepForever`); test "dừng CẢ CÂY" trong `src/main/commands/apps/__tests__/apps.test.ts`.

---

## 4. Test tay

### 4.1. Tắt hẳn MMC studio trước khi chạy `npm run dev`

**Quy tắc.** Trước khi test: tắt mọi bản MMC studio đang chạy — cả icon dưới khay, bản đã cài, bản `win-unpacked`.

**Vì sao.** App chỉ cho chạy một bản (`requestSingleInstanceLock`). Bản mới mở lên sẽ tự tắt và đưa **cửa sổ cũ** lên trước → tưởng đang test code mới nhưng thật ra là bản cũ (mất cả buổi tìm "sao không thấy tab Khám phá").

### 4.2. Test bản build không cần cài

Test bộ cài: chạy `release/<phiên bản>/win-unpacked/MMC studio.exe` thay vì cài đè lên bản đang dùng hằng ngày.

### 4.3. E2E hỏng ở phím tắt Ctrl+Alt+Q

Kiểm xem có bản MMC studio nào đang chạy và giữ phím đó không trước khi kết luận là lỗi code.

### 4.4. E2E kiểm "KHÔNG có" phải chờ việc đó xong trước

**Quy tắc.** `expect(x).not.toContainText(...)` / `toHaveCount(0)` pass ngay nếu UI chưa kịp đổi. Trước khi kiểm "không có", chờ một dấu hiệu việc đã xong (lượt trả lời kết thúc, có tin mới, nút Gửi hiện lại…).

**Vì sao.** Test "tắt tính năng → không còn tool" pass trong 55 ms vì kiểm khi trợ lý chưa trả lời — sẽ vẫn pass kể cả khi tính năng không tắt thật (#49).
