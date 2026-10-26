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
| **Hàng của mình (OWN)** | A — Hàng mình, kho mình | B — Hàng mình gửi đối tác ký gửi |
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

1. **Giảm giá chỉ áp dụng trên phần hàng của mình (BH).** Giảm giá cho khách không bao giờ làm thay đổi số tiền phải trả nhà cung cấp cho hàng ký gửi.
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
| — | **Tổng quan** | Doanh thu 14 ngày, cơ cấu tồn kho, công nợ, hàng bán chạy, cảnh báo (tồn thấp, lệch kiểm soát đối tác…) |
| **Hàng hoá & Kho** | Sản phẩm | Danh mục sản phẩm, mã OEM/mã tương đương, xe tương thích, giá bán |
| | Tồn kho theo lô | Xem tồn theo từng lô OWN/CONS, vị trí giữ hàng, kiểm kê & điều chỉnh |
| | Nhập kho | Tạo phiếu PN / NK thủ công, hoặc **Nhập từ Excel** (nút thứ ba trong trang) |
| **Ký gửi** | Gửi ký gửi | Lập phiếu GK gửi hàng cho đối tác |
| | Tiêu thụ của đối tác | Nhập báo cáo tiêu thụ BT, xem phân bổ PB → BH/KG |
| **Bán hàng & Hoá đơn** | Bán hàng | Bán tại quầy, chọn theo lô |
| | Hoá đơn GTGT | Phát hành/huỷ hoá đơn từ các dòng BH/KG đã xác nhận |
| | Trả hàng & bảo hành | Lập phiếu trả hàng TH |
| **Công nợ & Báo cáo** | Phải trả nhà cung cấp | Khoản phải trả phát sinh từ hàng ký gửi bán được; ghi thanh toán |
| | Phải thu đối tác | Khoản đối tác/khách còn nợ; ghi thu tiền |
| | Báo cáo | Đối soát nhà cung cấp/đối tác, xuất CSV |
| **Danh mục** | Nhà cung cấp | Hồ sơ NCC, hạn trả mặc định, cho phép ký gửi tiếp (ô D) hay không |
| | Đối tác | Hồ sơ đối tác (gara/cửa hàng/công ty), hạn mức ký gửi |
| — | **Cài đặt** | Chế độ hoá đơn GTGT mặc định, kho, quản lý tài khoản & vai trò |

---

## PHẦN C — NHẬP HÀNG CHI TIẾT (giải thích từng mục)

Trang **Nhập kho** có 3 nút: **Phiếu nhập mua (PN)** · **Phiếu nhận ký gửi (NK)** · **Nhập từ Excel**. Phiếu tạo ra ở trạng thái **Nháp**; chỉ khi bấm **Xác nhận** thì hàng mới thực sự vào kho (tạo lô + ghi sổ cái). Phiếu nháp sai có thể huỷ. Cả hai form nhập tay (PN, NK) đều có tick **Xác nhận ngay → tạo lô**: tick vào thì phiếu được xác nhận luôn trong cùng một thao tác, không qua bước nháp; không tick thì giữ luồng nháp để kiểm tra lại rồi xác nhận sau.

### C1. Phiếu nhập mua (PN) — mua đứt

**Các ô ở đầu phiếu:**

| Mục | Ý nghĩa |
|---|---|
| **Nhà cung cấp \*** | Bên bán hàng cho mình. Hàng về từ ai thì chọn đúng người đó — công nợ mua hàng và đối soát đi theo nhà cung cấp này. |
| **Kho \*** | Kho vật lý nhận hàng (kho của mình). Hàng nhập vào kho nào thì tồn và vị trí lô ghi theo kho đó. |
| **Ngày nhập** | Ngày hàng thực tế về kho — dùng cho báo cáo và truy vết lô theo thời gian. |
| **Số hoá đơn của nhà cung cấp** | Số hoá đơn GTGT mà nhà cung cấp xuất cho mình khi mua đứt — lưu để kế toán đối chiếu chứng từ mua vào. (Chỉ PN mới có ô này.) |

**Các cột trong bảng dòng hàng:**

| Cột | Ý nghĩa |
|---|---|
| **Sản phẩm** | Chọn từ danh mục (hiển thị dạng "Mã SKU — Tên hàng"). Có ô **quét mã vạch**: quét/nhập bất kỳ mã nào đã đăng ký của sản phẩm (mã OEM hoặc mã tương đương) rồi Enter, hệ thống tự chọn đúng sản phẩm; quét lại cùng mã sẽ cộng thêm 1 số lượng. |
| **Số lượng** | Số lượng thực nhập của dòng này. |
| **Đơn giá vốn (₫)** | Giá mình mua vào của 1 đơn vị — là cơ sở tính giá trị tồn kho và lãi gộp sau này. Nhập đúng giá theo hoá đơn mua (đã gồm các chi phí theo chính sách của cửa hàng). |

Kết quả khi xác nhận PN: tạo **lô OWN (nhãn trắng)** cho từng dòng, giá vốn của lô = đơn giá vốn đã nhập.

### C2. Phiếu nhận ký gửi (NK) — nhận hàng gửi bán hộ

Các ô **Nhà cung cấp \***, **Kho \***, **Ngày nhập** giống PN. Khác biệt:

| Mục | Ý nghĩa |
|---|---|
| **Hạn trả** | Hạn cuối được giữ hàng ký gửi chưa bán được (quá hạn thì trả lại nhà cung cấp hoặc xử lý theo thoả thuận). **Để trống = dùng hạn mặc định đã khai trong hồ sơ nhà cung cấp.** Hệ thống dùng hạn này để cảnh báo hàng ký gửi sắp hết hạn giữ. |
| **Giá ký gửi (₫)** *(cột trong bảng dòng hàng)* | Giá thoả thuận sẽ **trả cho nhà cung cấp cho mỗi đơn vị khi hàng bán được**. Đây là con số quyết định khoản phải trả sau này — nhập đúng theo thoả thuận/bảng giá ký gửi của từng nhà cung cấp, từng lô có thể khác nhau. |
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

**8 cột trong file Excel — chỉ nhập 8 cột này theo đúng thứ tự** (Tỷ giá, VAT, % lợi nhuận nhập trên form, áp chung cho cả file; tên cột viết bằng tiếng Việt tương ứng — Dòng xe, Tên phụ tùng, Tên tiếng anh, Mã số, Thương hiệu, ĐVT, Số lượng, Đơn giá USD — cũng được nhận):

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

**Bảng xem trước (preview) — đọc trạng thái từng dòng trước khi nhập:**

| Trạng thái | Ý nghĩa |
|---|---|
| **Đã có** (xanh lá) | Mã khớp với sản phẩm đã có trong danh mục — hàng nhập thêm vào sản phẩm đó. |
| **Hàng mới** (xanh dương) | Mã chưa có — sẽ tự tạo sản phẩm mới (khi bật tuỳ chọn tự tạo). |
| **Lỗi** (đỏ) | Dòng không hợp lệ (thiếu mã, số lượng ≤ 0, thiếu GiaUSD, hàng mới mà thiếu tên…). **Còn bất kỳ dòng lỗi nào là hệ thống không cho nhập** — sửa trong file Excel rồi tải lại. |
| **Trùng mã trong file** (vàng) | Mã xuất hiện từ 2 dòng trở lên trong cùng file — cần kiểm tra lại (thường là lỗi soạn file). |

Ngoài trạng thái, bảng xem trước còn cho thấy **kết quả tính toán của từng dòng**: Đơn giá USD, Đơn giá VND + VAT, Thành tiền, và Giá bán; cuối bảng là **Total giá nhập VND** — tổng khớp với kế toán (xem công thức).

**Công thức áp dụng cho mọi dòng (Tỷ giá, VAT, % lợi nhuận trên form áp chung cho cả file):** Đơn giá VND + VAT = GiaUSD × Tỷ giá × (1 + VAT%). Thành tiền = Số lượng × Đơn giá VND + VAT. Giá bán = Đơn giá VND + VAT × (1 + % lợi nhuận) — với hàng mới, giá bán này thành giá bán sỉ ban đầu của sản phẩm. Ví dụ: GiaUSD 100, Tỷ giá 27.000, VAT 8%, Lợi nhuận 35% → Đơn giá VND + VAT 2.916.000; Giá bán 3.936.600; nhập 15 cái → Thành tiền 43.740.000.

**Chênh lệch làm tròn (khớp kế toán, lưu ngầm):** đơn giá từng dòng được làm tròn về đồng chẵn (khớp hoá đơn nhà cung cấp), nên tổng các dòng có thể lệch vài chục đồng so với tổng làm tròn một lần ở cuối từ giá trị chính xác — đúng kiểu lệch 47 đồng từng gặp. Để tổng khớp tuyệt đối với kế toán, **Total giá nhập VND** ở cuối bảng = tổng làm tròn một lần (không phải tổng các dòng). Chênh lệch (= Total làm tròn một lần − tổng các dòng, có thể âm) vẫn được tính và lưu cùng phiếu nhập (cột `rounding_adjustment`), cộng vào tổng phiếu khi xác nhận — nhưng không hiện thành dòng riêng ở cuối bảng nữa, bảng chỉ hiện Total cuối cùng.

Sau khi bấm **Xác nhận nhập**: hệ thống kiểm tra lại toàn bộ ở máy chủ rồi mới ghi — phiếu tạo thành công sẽ **tự chuyển về đúng danh sách phiếu PN/NK ngay trong trang Nhập kho** để kiểm tra/xác nhận.

### C4. Luật kiểm soát định dạng file (từ chối khi nào?)

File bị **từ chối ngay, không xem trước**, kèm lý do cụ thể, khi: thiếu cột bắt buộc (MaHang / TenHang / SoLuong / GiaUSD); trùng tên cột; file trống hoặc không đọc được. Các cột cũ về giá theo dòng (GiaVonVND, TyGiaUSD, VAT, GiaBanDeXuat) không còn dùng — nếu còn trong file thì hệ thống bỏ qua. Dòng dữ liệu lỗi thì **chặn toàn bộ lần nhập** (không nhập một phần) — theo nguyên tắc: một phiếu nhập phải đúng 100% mới được vào kho, tránh kho sách lệch khó truy vết.

---

## PHẦN D — CÁC LUỒNG THAO TÁC CÒN LẠI

### D1. Gửi ký gửi cho đối tác (GK)
Vào **Ký gửi → Gửi ký gửi**: chọn đối tác, kho xuất, và **chọn theo lô** (bắt buộc chọn đúng lô — vì cùng sản phẩm có thể có nhiều lô khác chủ sở hữu). Hệ thống chặn gửi tiếp lô CONS của nhà cung cấp (ô D) trừ khi nhà cung cấp đó đã bật "Cho phép ký gửi tiếp" trong hồ sơ. Kiểm tra hạn mức ký gửi của đối tác trước khi xác nhận.

### D2. Bán tại quầy
Vào **Bán hàng → Bán hàng**: chọn khách/đối tác (nếu có), thêm dòng **theo lô**, nhập số lượng và giá bán. Hệ thống tự tách phần hàng mình → chứng từ **BH** (được áp giảm giá ở đây) và phần hàng ký gửi → chứng từ **KG**. Giảm giá chỉ trừ trên BH.

### D3. Tiêu thụ của đối tác & phân bổ
Khi đối tác báo đã bán được hàng họ đang giữ: vào **Ký gửi → Tiêu thụ của đối tác**, lập **BT** theo từng sản phẩm/số lượng đối tác báo. Hệ thống **phân bổ (PB)** số tiêu thụ vào các lô đối tác đang giữ (mặc định lô cũ trước — FIFO), sinh chứng từ BH/KG tương ứng và các khoản phải thu/phải trả liên quan. Đối tác bán chưa hết: phần còn lại vẫn nằm ở đối tác, không phát sinh tiền (xem A5).

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

### D8. Báo cáo
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
- Chỉ **Chủ cửa hàng** tạo/khoá/xoá tài khoản và gán vai trò (Cài đặt → Quản lý tài khoản). Đăng nhập bằng **tên đăng nhập hoặc email**.
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
| **OWN / CONS** | Hàng của mình / hàng ký gửi của nhà cung cấp. |
| **Nhãn trắng / nhãn vàng** | Quy ước dán nhãn vật lý: trắng = hàng mình (OWN), vàng = ký gửi (CONS). |
| **Ô D** | Hàng của nhà cung cấp đang nằm ở đối tác — trường hợp nhạy cảm, khoá mặc định. |
| **Phân bổ** | Chia số lượng tiêu thụ/bán vào từng lô cụ thể để xác định phần của mình (BH) và phần ký gửi (KG). |
| **Đối soát** | Đối chiếu số liệu hệ thống với nhà cung cấp/đối tác theo kỳ (đã nhận, đã bán, còn giữ, còn nợ). |
| **Sổ cái biến động** | Nhật ký mọi lần nhập/xuất theo lô — bất biến, là căn cứ truy vết duy nhất của tồn kho. |

*Tài liệu được cập nhật theo phiên bản hệ thống hiện tại. Khi quy trình thay đổi, cập nhật file này tại thư mục gốc của repo (HUONG-DAN-VAN-HANH.md).*
