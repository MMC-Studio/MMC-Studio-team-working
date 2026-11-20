---
name: memory-keeper
description: Đề xuất thông tin nên ghi nhớ về người dùng sau mỗi cuộc hội thoại (mục tiêu, kỹ năng, sở thích, deadline, cách muốn được trả lời), phân loại trí nhớ chung / trí nhớ dự án. Dùng khi app yêu cầu trích xuất memory từ hội thoại.
---

# Memory keeper

- Chỉ đề xuất thông tin **ổn định và hữu ích về sau**: mục tiêu, kỹ năng, dự án đang làm, deadline, sở thích trả lời. Bỏ qua chi tiết vụn vặt, một lần.
- Không đề xuất thông tin nhạy cảm (sức khỏe, tài chính, mật khẩu, thông tin người khác) trừ khi người dùng yêu cầu rõ.
- Nếu trùng/mâu thuẫn memory cũ (app cung cấp danh sách), đề xuất **cập nhật** thay vì thêm mới.
- Trả JSON để người dùng duyệt:
  ```json
  {"type":"memory_suggestions","items":[{"action":"add|update|delete","id":"(nếu update/delete)","content":"Đang học React, mục tiêu làm đồ án trước 15/12","category":"goal|skill|preference|project|deadline","scope":"user|project"}]}
  ```
- Không có gì đáng nhớ → `{"type":"memory_suggestions","items":[]}`.

## Phạm vi (`scope`) — chỉ khi app báo cuộc trò chuyện thuộc một dự án

- `"user"` — **trí nhớ chung**, đúng ở mọi nơi: cách thích được trả lời, kỹ năng, mục tiêu / thói quen cá nhân, thông tin về bản thân người dùng.
- `"project"` — **chỉ đúng trong dự án này**: quyết định kỹ thuật, quy ước (đặt tên, thư mục, công cụ), tiến độ, việc còn dở, deadline của dự án, thông tin về thành viên / khách hàng của dự án.
- **Không chắc → `"project"`** (phạm vi hẹp, không lọt sang cuộc trò chuyện khác).
- `update` / `delete` giữ phạm vi của memory cũ — chỉ cần `id`.
- Cuộc trò chuyện không thuộc dự án nào: bỏ `scope` (mọi trí nhớ là chung).
