# TVK — Hướng dẫn sử dụng & Mô hình vận hành

> Hệ thống quản lý hàng hoá & kho cho cửa hàng phụ tùng ô tô, thiết kế xoay quanh mô hình **vừa mua đứt vừa ký gửi hai chiều**.
> Địa chỉ sử dụng: **https://tvk-demo.vercel.app** (tên miền riêng tvk.thanhphan.io.vn dùng song song khi hạ tầng DNS hoạt động bình thường).
> Tài liệu này gồm 2 phần: **Mô hình vận hành** (hiểu hệ thống nghĩ như thế nào) và **Hướng dẫn thao tác** (làm từng việc ra sao, từng ô nhập có ý nghĩa gì).

---

## PHẦN A — MÔ HÌNH VẬN HÀNH

### A1. Nguyên lý cốt lõi: hàng hoá được quản lý theo LÔ, theo hai trục độc lập

Mỗi lần hàng về, hệ thống tạo một **lô (batch)**. Mọi biến động sau đó đều bám theo lô, không bám theo "sản phẩm" chung chung — vì cùng một mã hàng có thể vừa là hàng mình mua, vừa là hàng ký gửi của nhiều nhà cung cấp khác nhau, với giá khác nhau.

Mỗi lô mang hai thuộc tính độc lập:

**Trục 1 — Sở hữu (hàng của ai):**
- **OWN** — hàng của mình (mua đứt, đã trả tiền hoặc đang nợ tiền mua). Dán **nhãn trắng**.
- **CONS** — hàng ký gửi (của nhà cung cấp gửi bán hộ; chỉ trả tiền khi bán được). Dán **nhãn vàng**.

**Trục 2 — Nơi giữ hàng (hàng đang nằm ở đâu):**
- Tại **kho của mình**, hoặc
- Tại **đối tác** (gara / cửa hàng khác đang giữ hộ để bán).

Kết hợp thành 4 ô:

| | Ở kho mình | Ở đối tác |
|---|---|---|
| **Tồn kho (OWN)** | A — Hàng mình, kho mình | B — Hàng mình gửi đối tác ký gửi |
| **Hàng ký gửi (CONS)** | C — Hàng NCC gửi tại kho mình | D — Hàng của NCC đang ở đối tác (**khoá mặc định** — chỉ mở khi nhà cung cấp cho phép ký gửi tiếp) |

### A2. Sổ cái biến động không thể sửa/xoá

Tồn kho **không bao giờ được sửa trực tiếp**. Mọi thay đổi (nhập, xuất, bán, trả, chuyển nơi giữ) đều đi qua một **chứng từ**, và khi chứng từ được **xác nhận**, hệ thống ghi vào sổ cái biến động (stock ledger) — các dòng sổ cái **không sửa, không xoá được**, chứng từ sai chỉ được xử lý bằng cách **huỷ chứng từ** (giữ nguyên mã, chuyển trạng thái "Đã huỷ") hoặc lập chứng từ đối ứng (trả hàng). Nhờ vậy mọi con số đều truy vết được: lô nào, từ phiếu nào, ai tạo, khi nào.

### A3. Hệ thống chứng từ & mã chứng từ

Mỗi loại chứng từ có tiền tố riêng và số chạy liên tục, **không bao giờ tái sử dụng** (kể cả chứng từ đã huỷ):

| Mã | Tên chứng từ | Ý nghĩa |
|---|---|---|
| **PN** | Phiếu nhập mua | Mua đứt hàng từ nhà cung cấp → tạo lô OWN |
| **NK** | Phiếu nhận ký gửi | Nhận hàng ký gửi từ nhà cung cấp → tạo lô CONS |
| **GK** | Phiếu gửi ký gửi | Gửi hàng của mình cho đối tác giữ bán hộ |
| **BT** | Báo cáo tiêu thụ | Đối tác báo đã tiêu thụ (bán được) bao nhiêu hàng đang giữ |
| **PB** | Phân bổ tiêu thụ | Hệ thống phân bổ số tiêu thụ vào từng lô (của mình / ký gửi) |
| **BH** | Chứng từ bán hàng (nội bộ) | Phần hàng **của mình** trong một lần bán/tiêu thụ — **nơi duy nhất có giảm giá** |
| **KG** | Chứng từ ký gửi (nội bộ) | Phần hàng **ký gửi** trong một lần bán/tiêu thụ — sinh khoản **phải trả nhà cung cấp** theo đúng giá ký gửi của lô |
| **TH** | Phiếu trả hàng | Trả hàng: khách trả, trả đối tác, hoặc trả hàng ký gửi về nhà cung cấp |
| **DS** | Đợt đối soát | Gom các khoản phải thu/phải trả với một nhà cung cấp hoặc một đối tác theo kỳ (có từ ngày–đến ngày) để hai bên chốt số liệu trước khi thanh toán |
| **PT** | Phiếu thu | Ghi nhận tiền thu vào (từ đối tác/khách trả nợ) — mỗi lần thu sinh một mã PT riêng, không tái sử dụng |
| **PC** | Phiếu chi | Ghi nhận tiền chi ra (trả nợ nhà cung cấp) — mỗi lần chi sinh một mã PC riêng, không tái sử dụng |

### A4. Nguyên tắc tiền — ba quy tắc không bao giờ phá

1. **Giảm giá chỉ áp dụng trên phần tồn kho (BH).** Giảm giá cho khách không bao giờ làm thay đổi số tiền phải trả nhà cung cấp cho hàng ký gửi.
2. **Khoản phải trả nhà cung cấp chỉ sinh ra khi hàng ký gửi BÁN ĐƯỢC**, tính theo **giá ký gửi đã thoả thuận của đúng lô đó** — không sinh khi nhận hàng, không sinh khi gửi đi.
3. **Phân bổ trước, hoá đơn sau.** Một lần tiêu thụ có thể gồm cả hàng mình và hàng ký gửi; hệ thống luôn phân bổ rõ từng dòng thuộc lô nào/tính chất nào trước, rồi mới xuất hoá đơn GTGT từ các dòng đã phân bổ. Một hoá đơn GTGT có thể chứa cả hai tính chất (mỗi tính chất một dòng), nhưng chứng từ nội bộ BH/KG luôn tách riêng và liên kết với hoá đơn ở cấp độ từng dòng — tiền hai phía không bao giờ trộn lẫn.

### A5. Sơ đồ luồng vận hành tổng quát

```
NHÀ CUNG CẤP ──PN (mua đứt)──► LÔ OWN (nhãn trắng) ─┐
             └─NK (ký gửi)───► LÔ CONS (nhãn vàng) ─┤
                                                    ▼
                                              KHO CỦA MÌNH
                                                    │
              ┌──────────────────┬──────────────────┤
              ▼                  ▼                  ▼
        BÁN TẠI QUẦY        GỬI KÝ GỬI (GK)     TRẢ HÀNG (TH)
              │                  │
              │                  ▼
              │            ĐỐI TÁC GIỮ HÀNG ──BT──► báo tiêu thụ
              │                  │                    │
              └──────────────────┴────── PB phân bổ vào từng lô
                                       │
                              ┌────────┴────────┐
                              ▼                 ▼
                        BH (hàng mình)     KG (hàng ký gửi)
                              │                 │
                              ▼                 ▼
                     Hoá đơn GTGT        PHẢI TRẢ NCC
                     + PHẢI THU          (theo giá ký gửi của lô)
                       (đối tác/khách)
```

**Ví dụ kiểm chứng mô hình (đối tác vừa mua vừa ký gửi):** một công ty vận tải trong tháng lấy sản phẩm A: mua thẳng 5 cái + ký gửi 10 cái = tiêu thụ 15 cái. Xuất 3 hoá đơn: HĐ1 = 4 của mình + 3 ký gửi; HĐ2 = 4 ký gửi; HĐ3 = 1 của mình + 3 ký gửi. Hệ thống phân bổ từng hoá đơn về đúng lô; cuối kỳ lô OWN hết 5, lô CONS hết 10, sổ sách khớp tuyệt đối.

**Trường hợp bán chưa hết:** đối tác nhận 10 cái, mới bán 7 → chỉ 7 cái đi tiếp vào BT → phân bổ → hoá đơn; 3 cái còn lại vẫn nằm ở kho của đối tác trên hệ thống, **không phát sinh tiền** (không phải thu, không phải trả) cho đến khi bán được hoặc được trả lại bằng phiếu TH. Công thức kiểm soát tự động: **đã gửi = đã tiêu thụ + đã trả + còn tại đối tác**.

---

## PHẦN B — BẢN ĐỒ CHỨC NĂNG (MENU)

Menu bên trái gộp theo nhóm công việc, bấm tên nhóm để mở (mở nhóm khác thì nhóm cũ tự thu lại):

| Nhóm | Mục | Dùng để |
|---|---|---|
| — | **Tổng quan** | 5 tầng: (1) **Tổng quan điều hành** — doanh thu thuần lũy kế, lợi nhuận gộp (chỉ Chủ + Kế toán), phải thu/phải trả còn nợ, giá trị hàng sở hữu theo giá trị thật, kèm ghi chú doanh thu chưa tách thuế GTGT; (2) **Hàng hoá và quyền sở hữu** — số lượng tồn kho/giữ hộ/ở đối tác, thẻ **Theo sổ kế toán** chỉ Chủ cửa hàng và Kế toán xem được (tồn kho theo **giá vốn**, hàng giữ hộ tách riêng, không phải tài sản), thẻ **Cơ cấu tồn kho**: số nổi bật **Tổng giá trị hàng TVK sở hữu** theo giá vốn (kho TVK + hàng tại đối tác, không gồm hàng nhận ký gửi), donut nhỏ gọn với chú giải bên cạnh gồm 3 nhóm không trùng nhau (Hàng TVK tại kho / Hàng TVK tại đối tác / Hàng nhận ký gửi), bộ chọn cơ sở định giá (Giá trị thật, Giá vốn, Giá sỉ, Giá lẻ — hàng tại đối tác luôn tính theo giá chuyển giao, trừ khi chọn giá vốn thì tính theo giá vốn lô), 3 thẻ KPI giá vốn/giá sỉ/giá lẻ của hàng TVK trong kho kèm chênh lệch so với giá vốn và biên lợi nhuận gộp tiềm năng theo giá lẻ (chỉ Chủ cửa hàng và Kế toán xem được), giải thích cách tính thu gọn trong biểu tượng ⓘ, link xem chi tiết tồn kho; thẻ **Hàng đã bán và đã gửi ký gởi**, thẻ **Thống kê đối tác**: chọn đối tác là mở cửa sổ bật lên xem nhanh 5 số liệu, cuối cửa sổ có link mở trang chi tiết, không tải lại trang; mọi vai trò đều xem được, kể cả CEO; (3) **Hiệu quả kinh doanh** — biểu đồ doanh thu thuần 14 ngày, doanh thu theo nhóm hàng, mục **Phân tích đơn hàng** chỉ Chủ cửa hàng và Kế toán xem được (đoạn tóm tắt doanh thu thuần – giá vốn (lô thực tế, FIFO) – lợi nhuận gộp kèm ROS (lãi trên doanh thu thuần) và ROI (lãi trên vốn hàng) + biểu đồ cột đôi doanh thu/giá vốn từng chứng từ, không còn bảng chi tiết), top 5 bán chạy 30 ngày; (4) **Cảnh báo vận hành** — công nợ theo trạng thái kèm quá hạn, **hàng chậm luân chuyển** (còn tồn mà 90 ngày không xuất/bán/trả; hàng mới nhập trong 90 ngày không tính), hàng sắp hết, lô ký gửi phải trả trong 30 ngày, chênh lệch ký gửi tại đối tác; (5) **Hoạt động gần đây** — 8 bút toán kho mới nhất kèm link sang trang Sổ cái kho. Thứ tự tầng xếp theo vai trò: bán hàng thấy hiệu quả trước, thủ kho thấy hàng hoá và cảnh báo trước. |
| **Hàng hoá & Kho** | Sản phẩm | Danh mục sản phẩm, mã OEM/mã tương đương, xe tương thích, giá lẻ + giá đại lý; trang chi tiết sửa được tên/thương hiệu/đơn vị/tồn tối thiểu và bảng giá (Chủ cửa hàng + Thủ kho; mã SKU không sửa được) |
| | Tồn kho theo lô | Xem tồn theo từng lô OWN/CONS, vị trí giữ hàng, kiểm kê & điều chỉnh |
| | Nhập kho | Tạo phiếu PN / NK thủ công, hoặc **Nhập từ Excel** (nút thứ ba trong trang) |
| | Sổ cái kho | 200 bút toán kho mới nhất: lô, kho nguồn → kho đích, chứng từ, người làm; sổ cái chỉ ghi thêm, không sửa, không xoá; có lọc theo loại bút toán và tìm kiếm không dấu |
| **Ký gửi** | Gửi ký gửi | Lập phiếu GK gửi hàng cho đối tác (có nhập từ Excel) |
| | Tiêu thụ của đối tác | Nhập báo cáo tiêu thụ BT, xem phân bổ PB → BH/KG (BT và PB đều có nhập từ Excel) |
| **Bán hàng & Hoá đơn** | Bán hàng | Bán tại quầy, chọn theo lô; bảng đơn hàng và chứng từ BH/KG có nút Xuất Excel; bảng chứng từ BH/KG có thêm cột Giá vốn và Lãi gộp, chỉ Chủ cửa hàng và Kế toán xem được (giá vốn theo lô thực tế đã xuất, chứng từ nháp chưa có giá vốn) |
| | Hoá đơn GTGT | Phát hành/huỷ hoá đơn từ các dòng BH/KG đã xác nhận; bảng hoá đơn có nút Xuất Excel |
| | Trả hàng & bảo hành | Lập phiếu trả hàng TH; bảng phiếu trả có nút Xuất Excel |
| **Công nợ & Báo cáo** | Phải trả nhà cung cấp | Khoản phải trả phát sinh từ hàng ký gửi bán được; ghi thanh toán; bảng **Tuổi nợ phải trả** gom theo nhà cung cấp, 3 nhóm quá hạn 1–6 tháng |
| | Phải thu đối tác | Khoản đối tác/khách còn nợ; ghi thu tiền; bảng **Tuổi nợ phải thu** gom theo đối tác, 3 nhóm quá hạn 1–6 tháng |
| | Báo cáo | Đối soát nhà cung cấp/đối tác, xuất CSV |
| **Danh mục** | Nhà cung cấp | Hồ sơ NCC, hạn trả mặc định, cho phép ký gửi tiếp (ô D) hay không |
| | Đối tác | Hồ sơ đối tác (gara/cửa hàng/công ty), hạn mức ký gửi; bấm tên đối tác để mở trang chi tiết: số dư phải thu, đã thanh toán, số hoá đơn đã xuất + giá trị, hàng còn ở đối tác, đối soát ký gửi, bảng hàng hoá đang ký gửi theo lô kèm trạng thái bán (chưa bán / đã bán một phần / đã bán hết / đã trả lại), các khoản phải thu và hoá đơn |
| | Sửa hồ sơ | Ở bảng mỗi trang bấm **Sửa** — form bên phải chuyển sang chế độ sửa, điền lại rồi **Lưu thay đổi** (Chủ + Kế toán sửa được NCC; Chủ + Kế toán + Bán hàng sửa được đối tác; CEO chỉ xem) |
| — | **Cài đặt** | Chế độ hoá đơn GTGT mặc định, kho, quản lý tài khoản & vai trò |

---

## PHẦN C — NHẬP HÀNG CHI TIẾT (giải thích từng mục)

Trang **Nhập kho** có 3 nút: **Phiếu nhập mua (PN)** · **Phiếu nhận ký gửi (NK)** · **Nhập từ Excel**. Phiếu tạo ra ở trạng thái **Nháp**; chỉ khi bấm **Xác nhận** thì hàng mới thực sự vào kho (tạo lô + ghi sổ cái). Phiếu nháp hiện trong thẻ **"Phiếu nháp chờ xác nhận"** ngay đầu tab, với nút Xác nhận rõ ràng — hàng chưa vào kho cho tới khi xác nhận. Chỉ **Chủ cửa hàng** thấy nút **Xoá**, và chỉ ở phiếu **Nháp**: xoá hẳn phiếu nháp trong một thao tác, không khôi phục được; phiếu đã xác nhận không có nút Xoá vì sổ cái kho là bất biến (muốn sửa thì ghi dòng đảo ngược). Mã phiếu đã xoá không dùng lại. Sản phẩm trong danh mục không bị xoá theo phiếu. Cả hai form nhập tay (PN, NK) đều có tick **Xác nhận ngay → tạo lô**: tick vào thì phiếu được xác nhận luôn trong cùng một thao tác, không qua bước nháp; không tick thì giữ luồng nháp để kiểm tra lại rồi xác nhận sau.

### C1. Phiếu nhập mua (PN) — mua đứt

**Các ô ở đầu phiếu:**

| Mục | Ý nghĩa |
|---|---|
| **Nhà cung cấp \*** | Bên bán hàng cho mình. Hàng về từ ai thì chọn đúng người đó — công nợ mua hàng và đối soát đi theo nhà cung cấp này. |
| **Kho \*** | Kho vật lý nhận hàng (Kho TVK). Hàng nhập vào kho nào thì tồn và vị trí lô ghi theo kho đó. |
| **Ngày nhập** | Ngày hàng thực tế về kho — dùng cho báo cáo và truy vết lô theo thời gian. |
| **Số hoá đơn của nhà cung cấp** | Số hoá đơn GTGT mà nhà cung cấp xuất cho mình khi mua đứt — lưu để kế toán đối chiếu chứng từ mua vào. (Chỉ PN mới có ô này.) |

**Các cột trong bảng dòng hàng:**

| Cột | Ý nghĩa |
|---|---|
| **Sản phẩm** | Chọn từ danh mục (hiển thị dạng "Mã SKU — Tên hàng"). Có ô **quét mã vạch**: quét/nhập bất kỳ mã nào đã đăng ký của sản phẩm (mã OEM hoặc mã tương đương) rồi Enter, hệ thống tự chọn đúng sản phẩm; quét lại cùng mã sẽ cộng thêm 1 số lượng. |
| **Số lượng** | Số lượng thực nhập của dòng này. |
| **Đơn giá vốn (₫)** | Giá mình mua vào của 1 đơn vị — là cơ sở tính giá trị tồn kho và lãi gộp sau này. Nhập đúng giá theo hoá đơn mua (đã gồm các chi phí theo chính sách của cửa hàng). |
| **Hạn dùng (chỉ nhớt)** | Hạn dùng của lô hàng — chỉ nhập cho nhớt, để trống với linh kiện. Hạn dùng ghi vào lô khi xác nhận phiếu; nhớt xuất theo hạn gần nhất trước (FEFO). |

Kết quả khi xác nhận PN: tạo **lô OWN (nhãn trắng)** cho từng dòng, giá vốn của lô = đơn giá vốn đã nhập.

### C2. Phiếu nhận ký gửi (NK) — nhận hàng gửi bán hộ

Các ô **Nhà cung cấp \***, **Kho \***, **Ngày nhập** giống PN. Khác biệt:

| Mục | Ý nghĩa |
|---|---|
| **Hạn trả** | Hạn cuối được giữ hàng ký gửi chưa bán được (quá hạn thì trả lại nhà cung cấp hoặc xử lý theo thoả thuận). **Để trống = dùng hạn mặc định đã khai trong hồ sơ nhà cung cấp.** Hệ thống dùng hạn này để cảnh báo hàng ký gửi sắp hết hạn giữ. |
| **Giá ký gửi (₫)** *(cột trong bảng dòng hàng)* | Giá thoả thuận sẽ **trả cho nhà cung cấp cho mỗi đơn vị khi hàng bán được**. Đây là con số quyết định khoản phải trả sau này — nhập đúng theo thoả thuận/bảng giá ký gửi của từng nhà cung cấp, từng lô có thể khác nhau. |
| **Hạn dùng (chỉ nhớt)** *(cột trong bảng dòng hàng)* | Hạn dùng của lô hàng — chỉ nhập cho nhớt, để trống với linh kiện. Hạn dùng ghi vào lô khi xác nhận phiếu; nhớt xuất theo hạn gần nhất trước (FEFO). |
| *(không có)* Số hoá đơn NCC | Nhận ký gửi chưa phải mua hàng nên chưa có hoá đơn mua vào — ô này không xuất hiện ở NK. |

Kết quả khi xác nhận NK: tạo **lô CONS (nhãn vàng)**. **Chưa phát sinh khoản phải trả nào** — tiền chỉ phát sinh khi hàng bán được (xem A4).

### C3. Nhập từ Excel — nhập cả danh mục giao hàng trong một lần

Dùng khi nhà cung cấp giao cả một danh mục (ví dụ file bảng hàng tháng 10): **một file = một phiếu (PN hoặc NK) của một nhà cung cấp**.

**Khung trên cùng — chọn file:**

| Mục | Ý nghĩa |
|---|---|
| **Ô chọn file (.xlsx / .csv)** | Chọn file danh mục cần nhập. Hệ thống đọc và kiểm tra định dạng **ngay khi chọn** — file sai chuẩn bị từ chối ngay kèm danh sách lỗi cụ thể (xem C4). |
| **Nút "Tải file mẫu (.xlsx)"** | Tải file Excel mẫu đúng chuẩn (có sẵn dòng ví dụ + sheet hướng dẫn). Cách nhanh nhất để có file hợp lệ: điền theo mẫu rồi tải lên. |

**Các mục ở dưới — thông tin của phiếu sẽ tạo:**

| Mục | Ý nghĩa |
|---|---|
| **Loại phiếu \*** | **PN** = cả file là hàng mua đứt; **NK** = cả file là hàng ký gửi. Một file chỉ thuộc một loại — hàng hai loại phải tách hai file/phiếu. |
| **Nhà cung cấp \*** | Nhà cung cấp của cả phiếu (một file = một nhà cung cấp). |
| **Kho nhập \*** | Kho nhận toàn bộ hàng trong file. |
| **Ngày nhập** | Ngày của phiếu được tạo. |
| **Số hoá đơn của nhà cung cấp (chỉ PN)** | Như ở C1; để trống nếu là NK. |
| **Tỷ giá (VNĐ/USD)** | Tỷ giá áp dụng chung cho toàn bộ file để quy đổi giá USD sang VNĐ. Mặc định 27.000 — đổi theo tỷ giá tại thời điểm nhập. |
| **VAT % (cộng vào giá USD)** | % thuế áp dụng chung cho toàn bộ file, cộng thêm khi quy đổi giá USD (mặc định 8%). |
| **% lợi nhuận / sản phẩm** | % lợi nhuận áp dụng chung cho toàn bộ file để tính giá bán (mặc định 35%). Công thức giá bán: **Đơn giá VND + VAT × (1 + % lợi nhuận)**. |
| **Tự tạo sản phẩm mới nếu mã chưa có** | Bật: mã hàng chưa có trong danh mục sẽ được **tự tạo sản phẩm mới** (kèm mã thay thế + dòng xe trong file). Tắt: dòng nào mã chưa có sẽ báo lỗi và chặn import. |
| **Xác nhận nhập kho ngay sau khi tạo phiếu** | Bật: phiếu tạo xong được xác nhận luôn (hàng vào kho ngay). Tắt: phiếu ở trạng thái Nháp để kiểm tra lại rồi xác nhận sau ở danh sách phiếu. |

**8 cột bắt buộc + 1 cột tùy chọn trong file Excel — nhập theo đúng thứ tự** (Tỷ giá, VAT, % lợi nhuận nhập trên form, áp chung cho cả file; tên cột viết bằng tiếng Việt tương ứng — Dòng xe, Tên phụ tùng, Tên tiếng anh, Mã số, Thương hiệu, ĐVT, Số lượng, Đơn giá USD, Hạn dùng — cũng được nhận):

| Cột | Bắt buộc | Ý nghĩa |
|---|---|---|
| **DongXe** (Dòng xe) | | Dòng xe tương thích (ví dụ HOWO 420/430/440) — tạo thông tin xe tương thích cho sản phẩm mới. |
| **TenHang** (Tên phụ tùng) | ✔ | Tên phụ tùng. Bắt buộc với sản phẩm mới; sản phẩm đã có thì tên trong danh mục được giữ nguyên. |
| **TenTiengAnh** (Tên tiếng anh) | | Tên tiếng Anh nếu có — không bắt buộc, dòng nào chưa có vẫn nhập được (hiện hệ thống chưa lưu cột này vào danh mục). |
| **MaHang** (Mã số) | ✔ | Mã số của phụ tùng (SKU) — căn cứ khớp với danh mục. Khớp theo MaHang **hoặc bất kỳ mã thay thế nào** đã đăng ký. |
| **ThuongHieu** (Thương hiệu) | | Thương hiệu (ví dụ SMS, Normal…) — gán cho sản phẩm khi tự tạo mới. |
| **DonViTinh** (ĐVT) | | Đơn vị tính (cái, bộ, chiếc…). |
| **SoLuong** (Số lượng) | ✔ | Số lượng nhập, phải lớn hơn 0. |
| **GiaUSD** (Đơn giá USD) | ✔ | Đơn giá bằng USD của một đơn vị — đầu vào duy nhất để tính giá nhập. |
| **HanDung** (Hạn dùng) | | Hạn dùng của lô (chỉ nhớt) — ghi dạng ngày 01/05/2027 hoặc 2027-05-01; để trống nếu không có. Hạn dùng ghi vào từng lô khi xác nhận phiếu; nhớt xuất theo hạn gần nhất trước (FEFO), linh kiện xuất theo nhập trước (FIFO). |

**Bảng xem trước (preview) — đọc trạng thái từng dòng trước khi nhập:**

| Trạng thái | Ý nghĩa |
|---|---|
| **Đã có** (xanh lá) | Mã khớp với sản phẩm đã có trong danh mục — hàng nhập thêm vào sản phẩm đó. |
| **Hàng mới** (xanh dương) | Mã chưa có — sẽ tự tạo sản phẩm mới (khi bật tuỳ chọn tự tạo). |
| **Lỗi** (đỏ) | Dòng không hợp lệ (thiếu mã, số lượng ≤ 0, thiếu GiaUSD, hàng mới mà thiếu tên…). **Còn bất kỳ dòng lỗi nào là hệ thống không cho nhập** — sửa trong file Excel rồi tải lại. |
| **Trùng mã trong file** (vàng) | Mã xuất hiện từ 2 dòng trở lên trong cùng file — cần kiểm tra lại (thường là lỗi soạn file). |

Ngoài trạng thái, bảng xem trước còn cho thấy **kết quả tính toán của từng dòng**: Đơn giá USD, Đơn giá VND + VAT, Thành tiền, Giá đại lý và Giá lẻ; cuối bảng là **Total giá nhập VND** — tổng khớp với kế toán (xem công thức).

**Công thức áp dụng cho mọi dòng (Tỷ giá, VAT, % lợi nhuận, % giá bán lẻ trên form áp chung cho cả file):** Đơn giá VND + VAT = GiaUSD × Tỷ giá × (1 + VAT%), giữ chính xác tới 4 số lẻ, không làm tròn (migration 0014 — quyết định của chủ cửa hàng: tính đúng từng xu, để số lẻ). Thành tiền = Số lượng × Đơn giá VND + VAT (chính xác). Tổng phiếu = tổng chính xác các dòng. Giá đại lý = Đơn giá VND + VAT × (1 + % lợi nhuận); Giá lẻ = Đơn giá VND + VAT × (1 + % giá bán lẻ) — hai giá bán này vẫn làm tròn về đồng chẵn, chỉ giá vốn là tính chính xác — với hàng mới, hai giá này thành giá đại lý và giá lẻ ban đầu của sản phẩm (mặc định: lợi nhuận 35%, giá lẻ 50%, đổi được ngay trên form). Ví dụ: GiaUSD 100, Tỷ giá 27.000, VAT 8%, Lợi nhuận 35% → Đơn giá VND + VAT 2.916.000; Giá đại lý 3.936.600; Giá lẻ (50%) 4.374.000; nhập 15 cái → Thành tiền 43.740.000.

**Tính chính xác, không làm tròn đơn giá (migration 0014, từ 28/10):** đơn giá vốn giữ chính xác tới 4 số lẻ nên tổng các dòng bằng đúng tổng chính xác — không còn chênh lệch làm tròn. Hiển thị tiền làm tròn về đồng chẵn, không hiện số lẻ sau dấu phẩy (chỉ làm tròn lúc hiển thị; giá trị lưu trong database giữ chính xác). **Total giá nhập VND** ở cuối bảng = tổng chính xác các dòng. Cột `rounding_adjustment` ở phiếu nhập giữ lại làm chốt lịch sử (phiếu cũ vẫn giữ giá trị đã lưu, phiếu mới luôn ghi 0).

Sau khi bấm **Xác nhận nhập**: hệ thống kiểm tra lại toàn bộ ở máy chủ rồi mới ghi — phiếu tạo thành công sẽ **tự chuyển về đúng danh sách phiếu PN/NK ngay trong trang Nhập kho** để kiểm tra/xác nhận.

### C4. Luật kiểm soát định dạng file (từ chối khi nào?)

File bị **từ chối ngay, không xem trước**, kèm lý do cụ thể, khi: thiếu cột bắt buộc (MaHang / TenHang / SoLuong / GiaUSD); trùng tên cột; file trống hoặc không đọc được. Các cột cũ về giá theo dòng (GiaVonVND, TyGiaUSD, VAT, GiaBanDeXuat) không còn dùng — nếu còn trong file thì hệ thống bỏ qua. Dòng dữ liệu lỗi thì **chặn toàn bộ lần nhập** (không nhập một phần) — theo nguyên tắc: một phiếu nhập phải đúng 100% mới được vào kho, tránh kho sách lệch khó truy vết.

---

## PHẦN D — CÁC LUỒNG THAO TÁC CÒN LẠI

### D1. Gửi ký gửi cho đối tác (GK)
Vào **Ký gửi → Gửi ký gửi**: chọn đối tác, kho xuất, và **chọn theo lô** (bắt buộc chọn đúng lô — vì cùng sản phẩm có thể có nhiều lô khác chủ sở hữu). Hệ thống chặn gửi tiếp lô CONS của nhà cung cấp (ô D) trừ khi nhà cung cấp đó đã bật "Cho phép ký gửi tiếp" trong hồ sơ. Kiểm tra hạn mức ký gửi của đối tác trước khi xác nhận. Phiếu tạo ra ở trạng thái **Nháp**; hàng chỉ chuyển đi khi bấm **Xác nhận**. Phiếu nháp hiện trong thẻ vàng **"Phiếu gửi nháp chờ xác nhận"** ngay đầu trang, với nút Xác nhận rõ ràng — bảng bên dưới chỉ còn phiếu đã xác nhận.

**Nhập GK từ Excel:** cuối trang có mục **Nhập từ Excel (GK)** với nút **Tải file mẫu (.xlsx)**. Một file là một phiếu GK cho một đối tác — 6 cột `STT · Mã hàng · Dòng xe · Tên phụ tùng* · Số lượng* · Giá chuyển giao VND` (STT chỉ để đếm; hệ thống tìm hàng theo **tên phụ tùng + dòng xe** như form bán hàng, cột Mã hàng tùy chọn — chỉ cần khi tên trùng nhau để phân biệt; giá chuyển giao VNĐ, để trống = 0, dùng để kiểm tra hạn mức ký gửi khi xác nhận). Phiếu GK chỉ còn một bản chất là ký gửi — không còn cột Điều khoản, “mua đứt” thì làm ở mục Bán hàng. Không nhập mã lô — hệ thống tự phân bổ theo lô cũ nhất còn hàng tại Kho TVK (FIFO), một dòng có thể tách ra nhiều lô, trừ lô ký gửi của nhà cung cấp chưa cho ký gửi tiếp (khoá ô D). Hệ thống xem trước (kèm cảnh báo tên trùng mã như import nhập kho/bán hàng), kiểm tra tồn + khoá ô D + hạn mức, rồi mới tạo phiếu (tick “Xác nhận ngay” thì chuyển hàng luôn như phiếu tay, không tick thì tạo phiếu nháp). Dòng lỗi nào cũng chặn cả file — không nhập một phần.

### D2. Bán tại quầy
Vào **Bán hàng → Bán hàng**: một quầy duy nhất kiểu siêu thị, không chia tab. Chọn **Khách lẻ** hoặc một đối tác trong ô Khách hàng (gõ để lọc, bắt buộc chọn trong danh sách mới tính là đối tác) — giá tự theo loại: khách lẻ lấy **giá lẻ**, **Gara** lấy **giá gara**, đối tác còn lại lấy **giá đại lý**; đổi khách hàng thì các dòng đã thêm cũng đổi giá theo. Đã chọn đối tác thì ô Tên khách hàng tự hiện tên đối tác và khoá lại; khách lẻ thì gõ tên tự do. Tìm hàng ở ô tìm kiếm theo **tên, mã xe (dòng xe), mã hàng hoặc barcode** rồi **Enter** để thêm dòng xuống danh sách (máy quét gửi mã + Enter thì thêm ngay) — không có dòng trống chờ sẵn; tìm lại cùng món thì cộng số lượng (tối đa bằng tồn kho của lô). Dòng nào cũng lấy lô **FIFO** — lô cũ nhất còn hàng tại kho của mình — kèm giá theo loại khách; lô vẫn đổi tay được, mã hết hàng thì báo hết hàng; sản phẩm chưa đặt giá thì ô giá để trống cho tự nhập, đơn giá tự điền vẫn sửa tay được. Tick **Ghi nợ (tạo phải thu)** nếu bán nợ, rồi bấm nút **Bán hàng** cạnh ô tìm kiếm để hoàn tất. Hệ thống tự tách phần hàng mình → chứng từ **BH** (được áp giảm giá ở đây) và phần hàng ký gửi → chứng từ **KG**. Giảm giá chỉ trừ trên BH. Bên dưới quầy còn thẻ **"Nhập từ Excel (Bán hàng)"**: một file là một đơn bán sỉ hoặc lẻ (chọn đối tác hoặc khách lẻ ở form) vào đúng **ngày bán** chọn ở form — 6 cột `STT · Mã hàng · Dòng xe · Tên phụ tùng* · Số lượng* · Đơn giá` (STT chỉ để đếm; hệ thống tìm hàng theo **tên phụ tùng + dòng xe** vì tên đã tách biệt, cột Mã hàng tùy chọn — chỉ cần ghi khi tên trùng nhau để phân biệt, khi đó mã mới là chìa khoá; dòng nào thiếu cả tên lẫn mã thì bị từ chối; giá để trống = giá theo loại khách đã chọn: khách lẻ giá lẻ, Gara giá gara, đối tác khác giá đại lý; ghi số = bán đúng giá đó), có nút tải file mẫu; không nhập mã lô — hệ thống tự phân bổ theo lô cũ nhất còn hàng tại Kho TVK (FIFO), một dòng có thể tách ra nhiều lô (muốn bán đúng một lô cụ thể thì dùng quầy tay); mọi dòng lỗi đều chặn cả file, đơn tạo xong xác nhận ngay như nhập tay.

### D3. Tiêu thụ của đối tác & phân bổ
Khi đối tác báo đã bán được hàng họ đang giữ: vào **Ký gửi → Tiêu thụ của đối tác**, lập **BT** theo từng sản phẩm/số lượng đối tác báo. Hệ thống **phân bổ (PB)** số tiêu thụ vào các lô đối tác đang giữ (mặc định lô cũ trước — FIFO), sinh chứng từ BH/KG tương ứng và các khoản phải thu/phải trả liên quan. Đối tác bán chưa hết: phần còn lại vẫn nằm ở đối tác, không phát sinh tiền (xem A5).

**Nhập BT/PB từ Excel:** mỗi mục đều có **Nhập từ Excel** với nút **Tải file mẫu (.xlsx)**. BT: một file là một báo cáo cho một đối tác trong một kỳ, cột `MaHang*` · `SoLuongTieuThu*` (báo cáo chỉ ghi số lượng, không có giá). PB: một file là một phiếu phân bổ cho một đối tác, cột `MaHang*` · `MaLo*` (lô đang ở kho đối tác đó, phải thuộc đúng sản phẩm) · `NguonHang` (“Mua đứt”/“Ký gửi”, để trống = Ký gửi) · `SoLuong*` · `DonGiaVND` (VNĐ, để trống = 0). PB kiểm tra trước cả 3 chốt xác nhận (lượng đã báo, hạn mức theo tính chất, tồn tại kho đối tác). Cả hai đều có tick “Xác nhận ngay”; dòng lỗi nào cũng chặn cả file.

### D4. Hoá đơn GTGT
Vào **Bán hàng & Hoá đơn → Hoá đơn GTGT**: tick các dòng chứng từ BH/KG đã xác nhận chưa xuất hoá đơn, chọn đối tác, nhập số hoá đơn/ký hiệu/ngày. **Ngay trên form có ô chọn "Gộp thành 1 hoá đơn GTGT"**: tick = xuất **1 hoá đơn** chứa cả hai phần; bỏ tick = **tách 2 hoá đơn** (hoá đơn BH dùng số/ký hiệu chính; hoá đơn KG phải nhập thêm số/ký hiệu ở hai ô "phần ký gửi"). Ô chọn được đặt sẵn theo mặc định ở Cài đặt (mục dưới), đổi tại form chỉ áp dụng cho lần xuất đó. Huỷ hoá đơn chỉ mở lại đúng các dòng thuộc hoá đơn đó.

### D5. Công nợ
- **Phải trả nhà cung cấp**: tự sinh từ chứng từ KG khi hàng ký gửi bán được, theo đúng giá ký gửi của lô. Ghi thanh toán từng phần/toàn bộ; trạng thái Chưa trả / Trả một phần / Đã trả theo số còn lại.
- **Phải thu đối tác**: sinh từ phần bán cho đối tác/khách mua chịu. Ghi thu tiền tương tự; hoá đơn quá hạn được đánh dấu để đôn đốc.
- **Đối soát theo kỳ (DS):** ở trang Phải thu đối tác có nút "Tạo đợt đối soát (DS) cho một đối tác" — gom toàn bộ các khoản chưa chốt với một đối tác (hoặc một nhà cung cấp ở phía phải trả) trong một kỳ thành một đợt để hai bên xác nhận số liệu. **Phiếu thu/chi (PT/PC):** mỗi lần ghi nhận tiền thực tế (thu tiền mặt/chuyển khoản từ đối tác, hoặc chi trả cho nhà cung cấp) hệ thống sinh một phiếu PT hoặc PC có mã riêng, ghi rõ phương thức (tiền mặt/ngân hàng) và có thể gắn vào đợt đối soát DS tương ứng — đây là chứng từ tiền đối ứng với công nợ, giúp truy vết "khoản nợ này đã thu/chi bằng phiếu nào".

### D6. Trả hàng & bảo hành (TH)
Vào **Bán hàng & Hoá đơn → Trả hàng & bảo hành**: chọn loại trả (khách trả lại / trả hàng về đối tác / trả hàng ký gửi về nhà cung cấp), chọn dòng hàng theo lô. Hàng quay về đúng lô & vị trí tương ứng; các khoản tiền liên quan được đối ứng theo chứng từ gốc.

### D7. Kiểm kê & điều chỉnh tồn
Ở **Tồn kho theo lô**: đối chiếu số hệ thống với số đếm thực tế theo từng lô. Chênh lệch được ghi bằng **phiếu điều chỉnh qua sổ cái** (kèm lý do) — không sửa thẳng số tồn, để mọi chênh lệch đều có dấu vết kiểm kê.

### D8. In tem mã vạch (trang Sản phẩm)
Nút **In tem mã vạch** ở trang **Sản phẩm**: tick chọn các mã cần in (mặc định tick các mã còn hàng), số lượng mỗi mã mặc định bằng **tồn kho (Tổng)** — sửa tay được; chọn khổ tem (50×30, 40×30, 100×50 mm) và có thể tick **In giá lẻ lên tem**. Mỗi tem gồm mã vạch **Code128** của SKU, tên hàng, mã hàng (và giá lẻ nếu chọn). Hệ thống không điều khiển trực tiếp máy in: bấm **In** sẽ mở hộp thoại in của hệ điều hành — chọn đúng **máy in tem** đã cài driver và khổ tem trùng khổ đã chọn; mỗi tem là một trang. Tối đa 500 tem mỗi lần in (chia nhỏ nếu nhiều hơn).

### D9. Báo cáo
**Công nợ & Báo cáo → Báo cáo**: báo cáo tồn kho, bán hàng, đối soát với từng nhà cung cấp (hàng ký gửi: đã nhận / đã bán / còn giữ / phải trả) và từng đối tác (đã gửi / đã tiêu thụ / còn giữ / phải thu); xuất **CSV** để mở bằng Excel khi cần gửi đối tác/kế toán.

---

## PHẦN E — VAI TRÒ & PHÂN QUYỀN

Quyền được thực thi ở tầng dữ liệu (không chỉ ẩn nút): vai trò không có quyền thì dù biết đường dẫn cũng không đọc/ghi được dữ liệu ngoài phạm vi.

| Vai trò | Thấy & làm được | Giới hạn chính |
|---|---|---|
| **Chủ cửa hàng (OWNER)** | Toàn quyền: mọi số liệu (giá vốn, giá ký gửi, lãi), mọi thao tác, quản lý tài khoản | — |
| **CEO** | **Chỉ xem** toàn bộ: tổng quan tiền, kho, công nợ, báo cáo | Không tạo/sửa/xoá/xác nhận bất cứ thứ gì |
| **Kế toán (ACCOUNTING)** | Công nợ, hoá đơn GTGT, báo cáo, danh mục nhà cung cấp/đối tác | Không sửa kho, không xác nhận chứng từ kho |
| **Bán hàng (SALES)** | Bán tại quầy, tiêu thụ/hoá đơn (xem), đối tác | **Không thấy giá vốn, giá ký gửi, công nợ và lãi** |
| **Kho (WAREHOUSE)** | Nhập kho (PN/NK/Excel), tồn kho, gửi ký gửi, trả hàng, kiểm kê | Không thấy dữ liệu tiền (giá vốn hiển thị theo nhu cầu nhập liệu; không xem công nợ/báo cáo tài chính) |

### Tài khoản & mật khẩu
- Chỉ **Chủ cửa hàng** tạo/sửa/khoá/xoá tài khoản và gán vai trò (Cài đặt → Quản lý tài khoản). Sửa được họ tên và tên đăng nhập của từng tài khoản (kể cả tài khoản của chính mình); email không sửa được vì là danh tính đăng nhập. Đăng nhập bằng **tên đăng nhập hoặc email**. Quên mật khẩu: bấm **Quên mật khẩu?** ở trang đăng nhập để nhận email đặt lại, hoặc Chủ cửa hàng bấm **Đặt lại mật khẩu** trong Quản lý tài khoản.
- Chốt an toàn ở database: tài khoản thường tự sửa chỉ được đổi họ tên, tên đăng nhập và gỡ cờ bắt đổi mật khẩu — không tự nâng vai trò, tự mở khoá hay đổi email được, kể cả gọi API trực tiếp (migration 0013, trigger `trg_profiles_privilege_guard`).
- Tài khoản tạo bằng **mật khẩu tạm**, hoặc sau khi **đặt lại mật khẩu** (chủ cửa hàng bấm gửi, hay người dùng tự bấm "Quên mật khẩu"), sẽ **bị bắt buộc đổi mật khẩu ở lần đăng nhập kế tiếp** — chưa đổi xong thì chưa vào được hệ thống.
- **Chuẩn mật khẩu mạnh** cho mật khẩu tự đặt: tối thiểu **8 ký tự**, có chữ thường, chữ HOA, chữ số và ký tự đặc biệt. Trang đặt/đổi mật khẩu có checklist đánh dấu từng yêu cầu khi gõ.

### Cài đặt hệ thống (Cài đặt)
- **Chế độ hoá đơn GTGT**: COMBINED (gộp) / SEPARATE (tách) — là **mặc định** cho ô chọn khi phát hành hoá đơn (xem D4); nên chốt cùng kế toán theo mô hình hợp đồng ký gửi.
- Quản lý danh sách **kho** và **người dùng & vai trò** (đặt tên đăng nhập cho từng tài khoản).

---

## PHẦN F — NHỊP VẬN HÀNH GỢI Ý

| Khi nào | Việc |
|---|---|
| Hàng về | Lập PN/NK (tay hoặc Excel) → xác nhận → dán nhãn (trắng = OWN, vàng = CONS) đúng lô |
| Gửi hàng cho gara/đối tác | Lập GK theo lô; in/ghi lại số phiếu cho đối tác ký nhận |
| Cuối ngày | Nhập BT theo báo cáo bán của đối tác trong ngày; rà cảnh báo ở Tổng quan |
| Khi đối tác yêu cầu hoá đơn | Phân bổ xong → xuất hoá đơn GTGT (chọn gộp/tách theo đối tác) |
| Cuối tháng | Đối soát: Báo cáo theo NCC (ký gửi đã bán → phải trả) & theo đối tác (phải thu); thanh toán/đòi nợ theo hạn; kiểm kê quay vòng các lô giá trị cao |
| Định kỳ | Kiểm kê toàn kho theo lô; xử lý hàng ký gửi sắp hết hạn trả |

---

## PHẦN G — SỰ CỐ THƯỜNG GẶP

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| File Excel bị từ chối ngay | Đọc danh sách lỗi đỏ kèm theo (thiếu cột / trùng cột / không có cột giá…). Nhanh nhất: tải **file mẫu**, chép dữ liệu sang đúng cột rồi tải lại. |
| Có dòng "Lỗi" trong bảng xem trước | Hệ thống không nhập một phần — sửa các dòng đỏ trong file (thiếu mã/tên/giá, số lượng ≤ 0) rồi tải lại cả file. |
| Đăng nhập xong bị đưa tới trang Đổi mật khẩu | Tài khoản đang dùng mật khẩu tạm hoặc vừa yêu cầu đặt lại — đổi mật khẩu đạt chuẩn (checklist xanh hết) là vào được. |
| Không thấy giá vốn / giá ký gửi / công nợ | Vai trò của bạn không được xem dữ liệu đó (Bán hàng, Kho, CEO chỉ xem) — đây là phân quyền có chủ đích, không phải lỗi. |
| Trang tải chậm ở lần mở đầu tiên | Máy chủ "khởi động lạnh" sau thời gian không dùng — các lần mở sau trong phiên sẽ nhanh. Chuyển qua lại giữa các trang gần nhau được tăng tốc bằng bộ nhớ đệm 30 giây. |
| Quét mã vạch không ra sản phẩm | Mã chưa được đăng ký cho sản phẩm nào — vào Sản phẩm thêm mã (mã OEM/mã tương đương) cho đúng sản phẩm, hoặc quét mã SKU chính. |

---

## PHỤ LỤC — THUẬT NGỮ

| Thuật ngữ | Nghĩa |
|---|---|
| **Lô (batch)** | Đơn vị quản lý tồn kho: một lượng hàng về cùng một phiếu, cùng chủ sở hữu, cùng giá. |
| **OWN / CONS** | Tồn kho / hàng ký gửi của nhà cung cấp. |
| **Nhãn trắng / nhãn vàng** | Quy ước dán nhãn vật lý: trắng = hàng mình (OWN), vàng = ký gửi (CONS). |
| **Ô D** | Hàng của nhà cung cấp đang nằm ở đối tác — trường hợp nhạy cảm, khoá mặc định. |
| **Phân bổ** | Chia số lượng tiêu thụ/bán vào từng lô cụ thể để xác định phần của mình (BH) và phần ký gửi (KG). |
| **Đối soát** | Đối chiếu số liệu hệ thống với nhà cung cấp/đối tác theo kỳ (đã nhận, đã bán, còn giữ, còn nợ). |
| **Sổ cái biến động** | Nhật ký mọi lần nhập/xuất theo lô — bất biến, là căn cứ truy vết duy nhất của tồn kho. |

*Tài liệu được cập nhật theo phiên bản hệ thống hiện tại. Khi quy trình thay đổi, cập nhật file này tại thư mục gốc của repo (HUONG-DAN-VAN-HANH.md).*
