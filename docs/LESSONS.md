# Bài học & lỗi đã gặp — đọc trước khi thêm tính năng

File này ghi lại những lỗi team đã gặp khi làm MMC studio, để người làm sau (người hay AI) không vấp lại.
Mỗi mục: **Quy tắc** (phải làm gì) → **Vì sao** → **Mẫu có sẵn trong repo**.

Thêm bài học mới: thêm một mục vào cuối phần phù hợp, ghi kèm số PR nếu có.

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

---

## 3. Windows

### 3.1. Thư mục đang mở thì không đổi tên được

**Quy tắc.** Thay thư mục bằng cách đổi tên phải có đường lùi khi gặp `EPERM` / `EBUSY` / `EACCES` (vd ghi đè từng file tại chỗ), và báo lỗi kèm **lý do + tên file**, không chỉ mã chung.

**Vì sao.** Thư mục đang mở trong Explorer / trình soạn thảo / cửa sổ lệnh thì Windows không cho đổi tên → "Cài lại" plugin hỏng (#40).

### 3.2. Xoá junction đúng cách

Dùng `cmd /c rmdir <junction>`. **Không** dùng `Remove-Item -Recurse` lên junction — có thể xoá lan sang thư mục đích.

---

## 4. Test tay

### 4.1. Tắt hẳn MMC studio trước khi chạy `npm run dev`

**Quy tắc.** Trước khi test: tắt mọi bản MMC studio đang chạy — cả icon dưới khay, bản đã cài, bản `win-unpacked`.

**Vì sao.** App chỉ cho chạy một bản (`requestSingleInstanceLock`). Bản mới mở lên sẽ tự tắt và đưa **cửa sổ cũ** lên trước → tưởng đang test code mới nhưng thật ra là bản cũ (mất cả buổi tìm "sao không thấy tab Khám phá").

### 4.2. Test bản build không cần cài

Test bộ cài: chạy `release/<phiên bản>/win-unpacked/MMC studio.exe` thay vì cài đè lên bản đang dùng hằng ngày.

### 4.3. E2E hỏng ở phím tắt Ctrl+Alt+Q

Kiểm xem có bản MMC studio nào đang chạy và giữ phím đó không trước khi kết luận là lỗi code.
