/**
 * Nội dung Trợ giúp phân theo vai trò. `roles` chứa "ALL" (mọi vai trò)
 * hoặc các mã vai trò trong ROLE_LABELS (OWNER, SALES, WAREHOUSE,
 * ACCOUNTING, CEO). Nút Trợ giúp chỉ hiển thị các mục khớp vai trò của
 * người đang đăng nhập.
 */
export interface HelpSection {
  id: string;
  title: string;
  roles: string[];
  points: string[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "bat-dau-nhanh",
    title: "Bắt đầu nhanh",
    roles: ["ALL"],
    points: [
      "Đăng nhập bằng tên đăng nhập hoặc email và mật khẩu. Quên mật khẩu: nhờ Chủ cửa hàng (OWNER) bấm “Đặt lại mật khẩu” cho bạn trong Cài đặt → Quản lý tài khoản — email đặt lại mật khẩu sẽ gửi về hộp thư của bạn.",
      "Menu bên trái được gộp theo nhóm công việc: Hàng hoá & Kho (Sản phẩm, Tồn kho theo lô, Nhập kho, Lịch sử kho) · Ký gửi (Gửi ký gửi, Tiêu thụ của đối tác) · Bán hàng & Hoá đơn (Bán hàng, Hoá đơn GTGT (theo dõi nội bộ), Trả hàng & bảo hành) · Công nợ & Báo cáo (Phải trả, Phải thu, Báo cáo) · Danh mục (Nhà cung cấp, Đối tác). Bấm vào tên nhóm để mở — mở nhóm khác thì nhóm đang mở tự thu lại (mỗi lúc chỉ một nhóm mở); nhóm chứa trang bạn đang xem sẽ tự mở, và hệ thống nhớ lựa chọn của riêng bạn. Nhập hàng từ Excel nằm ngay trong trang Nhập kho (nút “Nhập từ Excel”).",
      "Trên điện thoại, menu nằm sau nút ☰ ở thanh trên cùng (bấm để mở, bấm nền mờ hoặc phím Escape để đóng). Đầu trang Tổng quan có hàng “Lối tắt” theo đúng vai trò của bạn để vào nhanh các trang hay dùng — chỉ là đường dẫn, không mở thêm quyền.",
      "Nguyên tắc cốt lõi: mọi hàng hoá thuộc một trong hai loại — Hàng hoá của TVK (mua đứt, lô OWN) và Hàng được ký gửi (nhà cung cấp gửi cho TVK bán hộ, lô CONS). Cùng một sản phẩm có thể có cả hai loại lô, nên hãy luôn chọn đúng lô khi bán, gửi đi hoặc trả hàng.",
      "Quét mã vạch: các form có ô “Quét mã vạch / nhập mã hàng” (Nhập kho, Tiêu thụ của đối tác) nhận mã từ máy quét mã vạch hoặc gõ tay rồi Enter — hệ thống khớp theo SKU hoặc bất kỳ mã tra cứu nào đã đăng ký cho sản phẩm; quét lại cùng một mã sẽ cộng thêm 1 số lượng.",
      "Tồn kho không sửa tay được: mọi thay đổi đều đi qua một phiếu (nhập kho, nhận ký gửi, gửi ký gửi, báo cáo đã bán, chia hàng, bán hàng, trả hàng) và được ghi lại, không sửa/xoá được, nên số liệu luôn tra lại được.",
      "Nút Trợ giúp ở góc trên bên phải luôn hiển thị hướng dẫn đúng với vai trò của bạn.",
      "Đổi mật khẩu bắt buộc: nếu bạn đăng nhập lần đầu bằng mật khẩu tạm do Chủ cửa hàng cấp, hoặc sau khi yêu cầu đặt lại mật khẩu, hệ thống sẽ đưa bạn tới trang đổi mật khẩu và chưa cho vào làm việc cho đến khi đổi xong. Mật khẩu mới phải đạt chuẩn: ít nhất 8 ký tự, có chữ thường, chữ HOA, chữ số và ký tự đặc biệt.",
    ],
  },

  // ---------------------------------------------------------------- OWNER
  {
    id: "owner-quan-ly-tai-khoan",
    title: "Quản lý tài khoản nhân viên",
    roles: ["OWNER"],
    points: [
      "Vào Cài đặt → Quản lý tài khoản để tạo tài khoản: chọn “Gửi email mời” (người dùng tự đặt mật khẩu qua email) hoặc “Đặt mật khẩu tạm ngay” (mật khẩu tối thiểu 8 ký tự), điền họ tên, tên đăng nhập (tuỳ chọn) và vai trò.",
      "Trong danh sách tài khoản: đổi vai trò bằng cách chọn lại vai trò (áp dụng ngay); “Khoá / Mở khoá” để tạm ngưng hoặc khôi phục quyền đăng nhập mà không xoá dữ liệu; “Đặt lại mật khẩu” gửi email khôi phục cho nhân viên; “Xoá” gỡ hẳn tài khoản và không khôi phục được.",
      "Các chốt an toàn: bạn không thể tự đổi vai trò, tự khoá hay tự xoá chính mình, và hệ thống luôn giữ ít nhất một Chủ cửa hàng (kể cả một Chủ cửa hàng đang hoạt động khi khoá tài khoản).",
      "Mật khẩu: tài khoản tạo bằng “Đặt mật khẩu tạm ngay” sẽ bị bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên; bấm “Đặt lại mật khẩu” cho nhân viên cũng gắn cờ tương tự. Mật khẩu người dùng tự đặt phải đạt chuẩn mạnh (ít nhất 8 ký tự, đủ chữ thường, chữ HOA, chữ số và ký tự đặc biệt) — trang đặt/đổi mật khẩu có checklist hiển thị từng yêu cầu.",
      "Khi phân vai trò hãy nhớ nguyên tắc tối thiểu: Bán hàng không thấy giá vốn, giá ký gửi và lợi nhuận; Thủ kho không thấy dữ liệu tiền; Kế toán không sửa được kho; CEO xem được mọi số liệu kể cả giá vốn và lợi nhuận nhưng không thao tác được gì.",
    ],
  },
  {
    id: "owner-che-do-hoa-don-gtgt",
    title: "Chế độ hoá đơn GTGT — COMBINED hay SEPARATE?",
    roles: ["OWNER"],
    points: [
      "Chứng từ quản lý nội bộ BH (bán trực tiếp) và KG (ký gửi) LUÔN tách riêng, bất kể cài đặt này — để tiền bán trực tiếp và tiền ký gửi không bao giờ trộn lẫn, và khoản phải trả cho nhà cung cấp luôn tính đúng theo từng chứng từ KG.",
      "Cài đặt ở Cài đặt → Chế độ hoá đơn GTGT (theo dõi nội bộ) là MẶC ĐỊNH cho cách ghi nhận hoá đơn: COMBINED = một hoá đơn GTGT cho cả hai loại (mỗi loại một dòng); SEPARATE = hai hoá đơn GTGT riêng, mỗi hoá đơn một loại. Khi ghi nhận, người ghi chọn lại Gộp/Tách ngay trên form Hoá đơn GTGT cho từng lần ghi nhận.",
      "TVK chỉ theo dõi hoá đơn nội bộ: hoá đơn GTGT chính thức do hệ thống hoá đơn khác xuất. Ở đây Kế toán chỉ ghi nhận lại đúng số hoá đơn, ký hiệu và ngày của hoá đơn chính thức đó, để đối chiếu với phiếu bán.",
      "Hãy chốt lựa chọn này cùng kế toán và hợp đồng ký gửi đã ký trước khi vận hành thật. Đổi cài đặt chỉ ảnh hưởng các hoá đơn ghi nhận sau đó, không thay đổi hoá đơn đã ghi nhận.",
    ],
  },
  {
    id: "owner-dieu-hanh",
    title: "Điều hành qua Tổng quan & Báo cáo",
    roles: ["OWNER"],
    points: [
      "Vào Tổng quan để nắm tình hình nhanh: đầu trang là 5 số lớn — Doanh thu, Lãi gộp, Tiền mặt & ngân hàng, Phải thu quá hạn, Giá trị hàng sở hữu (theo giá vốn) — rồi tới khối cảnh báo (dòng tiền 14–30 ngày, lệch ký gửi, công nợ quá hạn). Sau đó là 4 nhóm: Rủi ro và tồn đọng (tiền nợ quá hạn, hàng để 90 ngày không bán được, hàng sắp hết, lô ký gửi sắp đến hạn trả, hàng gửi đối tác bị lệch số); Phân tích kinh doanh (biểu đồ Doanh thu – Giá vốn – Lãi theo kỳ đã chọn, mặc định 90 ngày, kèm giá trị tồn kho theo nhóm và doanh thu theo nhóm); Tài sản và hàng hóa (số lượng, thẻ tiền hàng theo giá vốn, biểu đồ 3 vòng, hàng ký gửi bán được bao nhiêu, đối tác đã bán được bao nhiêu hàng ký gửi); Hoạt động kho gần đây (8 lần nhập – xuất mới nhất). Phân tích đơn hàng, Top 5 bán chạy, Thống kê đối tác và Hoạt động kho gần đây thu gọn mặc định — bấm tiêu đề để mở. Thứ tự các nhóm xếp theo vai trò của bạn.",
      "Biểu đồ Doanh thu – Giá vốn – Lãi có bộ chọn kỳ ở góc phải của thẻ (7/14/30/90 ngày, tháng này, quý này, tất cả, hoặc khoảng ngày tùy chọn) — bộ chọn này chỉ điều khiển đúng biểu đồ đó; các con số còn lại trên trang vẫn tính toàn thời gian hoặc tại thời điểm hiện tại. Doanh thu hiển thị chưa tách thuế GTGT.",
      "Chú ý các mục cần xem ở Tổng quan: “Hàng sắp hết” (tồn bằng hoặc dưới mức tối thiểu), “Lô ký gửi phải trả trong 30 ngày tới”, và bảng hàng gửi đối tác bị lệch số (số đã gửi không khớp với số đã bán + đã trả lại + còn giữ) — số lệch cần hỏi lại đối tác trước lần đối chiếu sau.",
      "Ở trang chi tiết đối tác, dòng tóm tắt phía trên mỗi bảng hiện mã phiếu bán/phiếu gửi + ngày — bấm vào mã để mở cửa sổ chi tiết hàng hoá kèm tiền bán (hoặc dự kiến với hàng ký gửi) và lãi gộp (hoặc dự kiến). Bảng phía dưới chỉ còn số lượng và tiền, không lặp lại cột chứng từ.",
      "Vào Báo cáo để đối chiếu ký gửi với nhà cung cấp và đối tác theo kỳ, và xuất CSV khi cần gửi số liệu ra ngoài.",
      "Giá ký gửi và lợi nhuận chỉ Chủ cửa hàng, Kế toán và CEO xem được — cân nhắc kỹ trước khi cấp thêm tài khoản OWNER.",
    ],
  },

  // ---------------------------------------------------------------- SALES
  {
    id: "sales-ban-hang-tai-quay",
    title: "Ghi nhận đơn bán hàng (bán lẻ tại quầy đang tạm dừng)",
    roles: ["SALES"],
    points: [
      "Bán lẻ tại quầy đang TẠM DỪNG từ 30/10/2026: quầy bán trực tiếp (tìm hàng, quét mã, bấm bán) đã tắt — việc bán hàng diễn ra ở hệ thống khác, TVK chỉ lưu trữ thông tin để đối chiếu. Muốn ghi nhận một đơn bán, dùng thẻ “Nhập từ Excel (Bán hàng)” ở trang Bán hàng.",
      "Vào Bán hàng → thẻ “Nhập từ Excel (Bán hàng)”: chọn đối tác (hoặc khách lẻ), ngày bán, tick “Ghi nợ (tạo phải thu)” nếu bán nợ, rồi tải file 6 cột (mã hàng, dòng xe, tên phụ tùng, số lượng, đơn giá). Hệ thống khớp hàng theo mã trước, thiếu mã thì theo tên + dòng xe, và tự chia theo lô cũ nhất còn hàng (nhớt thì ưu tiên lô sắp hết hạn trước; linh kiện thì nhập trước xuất trước).",
      "Phiếu bán tự tách theo lô: lô của TVK vào phiếu BH, lô được ký gửi vào phiếu KG và tự động tạo khoản phải trả cho nhà cung cấp của lô đó theo giá ký gửi. Vì vậy kiểm tra đúng lô trong bảng xem trước là bước quan trọng nhất.",
      "Ô “Giảm giá cho phần BH” chỉ trừ vào phần tồn kho (BH); giảm giá không bao giờ làm thay đổi khoản phải trả cho nhà cung cấp của hàng ký gửi.",
      "Ghi nhận xong, tồn kho và tiền nợ cập nhật ngay — kiểm tra lại ở hai bảng “Đơn hàng gần đây” và “Phiếu bán (BH / KG)” ngay dưới form. Đơn đã ghi nhận và phiếu bán đã xác nhận vẫn xem lại được đầy đủ.",
    ],
  },
  {
    id: "sales-tieu-thu-phan-bo",
    title: "Tiêu thụ của đối tác & chia hàng",
    roles: ["SALES"],
    points: [
      "Vào Tiêu thụ của đối tác: khi đối tác báo đã bán được hàng, tạo “Báo cáo đối tác đã bán (BT)” — chọn đối tác, kỳ từ ngày–đến ngày, số lượng đã bán của từng sản phẩm (có thể quét mã vạch) — rồi bấm “Xác nhận báo cáo” ở danh sách.",
      "Tiếp theo tạo “Phiếu chia hàng đã bán cho từng lô (PB)”: gán từng số lượng đã bán vào đúng Lô tại đối tác, chọn Nguồn hàng — Mua đứt hoặc Ký gửi — và đơn giá. Việc chia hàng phải làm TRƯỚC khi xuất hoá đơn.",
      "Mở phiếu chia hàng (nút “Mở”) → “Xác nhận chia hàng”: hệ thống kiểm tra 3 điều: không chia quá số đối tác đã báo bán, không vượt số hàng đã giao cho từng loại (mua đứt/ký gửi), và lô phải còn đủ hàng ở đối tác.",
      "Sau khi chia hàng được xác nhận, bấm “Tạo phiếu bán BH/KG” cho các dòng đang chờ; mỗi số lượng chỉ được chia và xuất hoá đơn đúng một lần, không nhập lại trên hoá đơn.",
    ],
  },
  {
    id: "sales-hoa-don-va-gioi-han",
    title: "Hoá đơn GTGT (theo dõi nội bộ) & giới hạn của vai trò Bán hàng",
    roles: ["SALES"],
    points: [
      "Menu Hoá đơn GTGT (theo dõi nội bộ) với vai trò Bán hàng là CHỈ XEM danh sách hoá đơn đã ghi nhận: việc ghi nhận và huỷ ghi nhận do Kế toán (hoặc Chủ cửa hàng) thực hiện từ các dòng chứng từ BH/KG đã xác nhận.",
      "Vai trò của bạn không xem được giá vốn, giá ký gửi, lợi nhuận và phải trả nhà cung cấp; tầng Tổng quan điều hành trên trang Tổng quan cũng không hiện với vai trò Bán hàng — các giới hạn này chặn ở cơ sở dữ liệu, không phải chỉ ẩn trên giao diện.",
      "Cần số liệu tài chính, hoặc cần sửa chứng từ đã xác nhận: liên hệ Kế toán hoặc Chủ cửa hàng để xử lý.",
    ],
  },

  // ------------------------------------------------------------ WAREHOUSE
  {
    id: "warehouse-nhap-kho",
    title: "Nhập kho PN / NK",
    roles: ["WAREHOUSE"],
    points: [
      "Vào Nhập kho: tab “Phiếu nhập mua (PN)” dùng cho hàng mua đứt — nhập giá vốn; tab “Phiếu nhận ký gửi (NK)” dùng cho hàng được nhà cung cấp ký gửi — nhập giá ký gửi và hạn trả nếu khác mặc định của nhà cung cấp đó.",
      "Chọn nhà cung cấp, kho, ngày nhập; thêm từng dòng bằng cách chọn sản phẩm hoặc quét mã vạch vào ô “Quét mã vạch”, nhập số lượng và đơn giá; bấm “Tạo phiếu nháp”.",
      "Kiểm tra lại phiếu nháp rồi bấm “Xác nhận → tạo lô”: PN tạo lô OWN (của mình), NK tạo lô CONS (ký gửi). Hàng ký gửi khi mới nhận CHƯA tạo khoản phải trả — khoản phải trả chỉ phát sinh khi hàng ký gửi bán được.",
      "Phiếu đã xác nhận không sửa trực tiếp được: nếu sai, báo Chủ cửa hàng / Kế toán để xử lý bằng chứng từ phù hợp (phiếu trả, điều chỉnh) thay vì cố sửa số tồn.",
    ],
  },
  {
    id: "warehouse-nhap-excel",
    title: "Nhập từ Excel đúng chuẩn",
    roles: ["WAREHOUSE"],
    points: [
      "Vào Nhập kho → bấm nút “Nhập từ Excel” → bấm “Tải file mẫu” và điền đúng file mẫu 9 cột theo đúng thứ tự: DongXe, TenHang, TenTiengAnh, MaHang, ThuongHieu, DonViTinh, SoLuong, GiaUSD, HanDung (cột Hạn dùng chỉ dành cho nhớt, để trống với linh kiện). Cột TenTiengAnh chỉ để đọc, không lưu. Bắt buộc có: MaHang, TenHang, SoLuong, GiaUSD.",
      "Chọn loại phiếu (PN / NK), nhà cung cấp, kho, ngày nhập, tỷ giá (mặc định 27.000), VAT% (mặc định 8%), % lợi nhuận (mặc định 35%), % giá bán lẻ (mặc định 50%) và nhóm hàng cho sản phẩm mới — các con số này áp cho CẢ FILE. Giá vốn mỗi dòng = GiaUSD × tỷ giá × (1 + VAT%), giữ nguyên không làm tròn; giá đại lý và giá lẻ làm tròn đồng. Chỉ sản phẩm mới tự tạo mới được ghi giá — sản phẩm đã có thì giá cũ giữ nguyên.",
      "Luôn kiểm tra bảng xem trước: dòng “Đã có” khớp vào sản phẩm hiện hữu, dòng “Hàng mới” sẽ được tự tạo (khi bật tuỳ chọn tự tạo), dòng báo “Lỗi” hoặc file sai định dạng sẽ bị TỪ CHỐI TOÀN BỘ — hãy sửa file rồi tải lại, hệ thống không nhập một phần. Nếu một tên hàng ứng với hai mã khác nhau, bảng xem trước hiện cảnh báo vàng để bạn kiểm tra, nhưng không chặn nhập.",
      "Một file chỉ tương ứng một phiếu của một nhà cung cấp. Nhập xong, hệ thống tự chuyển về danh sách phiếu ở trang Nhập kho — phiếu vừa tạo nằm ngay bên dưới để kiểm tra; cần xác nhận ngay thì bật “Xác nhận nhập kho ngay sau khi tạo phiếu” trước khi bấm “Xác nhận nhập”.",
    ],
  },
  {
    id: "warehouse-gui-ky-gui",
    title: "Gửi ký gửi (GK) & hạn trả hàng ký gửi",
    roles: ["WAREHOUSE"],
    points: [
      "Vào Gửi ký gửi: chọn đối tác, thêm dòng chọn Lô tại Kho TVK, số lượng và giá chuyển giao; tạo phiếu nháp rồi bấm “Xác nhận → chuyển hàng tới đối tác”. Muốn gửi nhiều dòng một lúc thì dùng thẻ “Nhập từ Excel (GK)” — file 6 cột (mã hàng, dòng xe, tên, số lượng, giá chuyển giao), khớp theo mã hàng trước, thiếu mã thì khớp theo tên + dòng xe; hệ thống tự chia theo lô cũ nhất (nhớt thì ưu tiên lô sắp hết hạn trước).",
      "Gửi hàng chỉ thay đổi nơi giữ hàng — hàng vẫn là của TVK, chưa ghi doanh thu và chưa ghi phải thu. Tiền chỉ phát sinh khi đối tác báo đã bán và số lượng được chia.",
      "Gửi tiếp lô hàng được ký gửi (hàng của nhà cung cấp đang ở Kho TVK, gửi tiếp cho đối tác) bị hệ thống chặn, trừ khi nhà cung cấp đó đã bật “Cho phép gửi tiếp hàng ký gửi của nhà cung cấp này cho đối tác khác” ở menu Nhà cung cấp.",
      "Theo dõi hạn trả của các lô ký gửi ở Tổng quan (mục “Lô ký gửi phải trả trong 30 ngày tới”) và ở Tồn kho theo lô (cột Hạn trả) để trả hàng đúng hạn cho nhà cung cấp.",
    ],
  },
  {
    id: "warehouse-tra-hang-kiem-ke",
    title: "Trả hàng, bảo hành & kiểm kho",
    roles: ["WAREHOUSE"],
    points: [
      "Vào Trả hàng & bảo hành (TH): chọn Loại trả hàng (Khách trả hàng / Đối tác trả hàng / Trả nhà cung cấp), chọn đúng Lô gốc, số lượng và Lý do; tạo phiếu nháp rồi xác nhận. Hàng trả luôn quay về đúng lô gốc để tra lại được nhà cung cấp và giá vốn.",
      "Kiểm kho và sửa số tồn: vào Tồn kho theo lô → mục “Kiểm kho và sửa số tồn (hệ thống tự ghi lại)”, chọn lô và vị trí, nhập số hàng thừa/thiếu (+ tăng / − giảm) kèm lý do, bấm “Ghi điều chỉnh”. Thao tác này vẫn được ghi lại như mọi lần nhập – xuất khác.",
      "Giới hạn của vai trò Kho: không có dữ liệu tiền — giá ký gửi, tiền nợ, hoá đơn và thanh toán thuộc quyền của Chủ cửa hàng và Kế toán.",
    ],
  },

  // ----------------------------------------------------------- ACCOUNTING
  {
    id: "accounting-hoa-don-gtgt",
    title: "Ghi nhận & huỷ hoá đơn GTGT (theo dõi nội bộ)",
    roles: ["ACCOUNTING"],
    points: [
      "Vào Hoá đơn GTGT (theo dõi nội bộ): chọn đối tác, nhập Số hoá đơn, Ký hiệu, Ngày hoá đơn và nhà cung cấp hoá đơn điện tử theo đúng hoá đơn đã xuất từ hệ thống hoá đơn chính thức, tick các dòng phiếu bán (BH/KG) cần đưa vào, rồi bấm “Ghi nhận hoá đơn”.",
      "Hoá đơn chỉ ghi nhận được từ các dòng chứng từ ĐÃ XÁC NHẬN và chưa từng ghi nhận hoá đơn; mỗi dòng trên hoá đơn luôn gắn với đúng một phiếu bán, nên tiền ký gửi và tiền bán trực tiếp không bao giờ trộn lẫn.",
      "Gộp hay tách được chọn ngay trên form ghi nhận: tick ô “Gộp thành 1 hoá đơn GTGT” = một hoá đơn cho cả BH + KG; bỏ tick = tách hai hoá đơn — hoá đơn BH dùng Số hoá đơn/Ký hiệu chính, hoá đơn KG phải nhập thêm Số hoá đơn/Ký hiệu phần ký gửi. Ô tick được đặt sẵn theo mặc định (COMBINED / SEPARATE) ở Cài đặt.",
      "Bấm “Huỷ hoá đơn” ở danh sách khi cần huỷ: thao tác này chỉ mở lại đúng các dòng thuộc hoá đơn đó để xuất lại, các hoá đơn khác không bị ảnh hưởng.",
    ],
  },
  {
    id: "accounting-cong-no-doi-soat",
    title: "Phải trả, phải thu & đối chiếu sổ sách",
    roles: ["ACCOUNTING"],
    points: [
      "Phải trả nhà cung cấp phát sinh TỰ ĐỘNG khi một lô ký gửi bán được (ghi nhận qua Excel hoặc qua chia hàng đã bán), tính theo đúng giá ký gửi đã thoả thuận của lô; giảm giá cho khách hàng không bao giờ làm thay đổi số phải trả này. Xác nhận phiếu nhập mua hàng (PN) cũng tự tạo một khoản phải trả bằng tổng tiền phiếu, hạn trả theo số ngày trả của nhà cung cấp đó.",
      "Vào Phải trả nhà cung cấp / Phải thu đối tác để xem số còn nợ và hạn thanh toán; mỗi khi trả hoặc thu tiền, dùng form “Ghi nhận thanh toán cho nhà cung cấp (PC)” / “Ghi nhận tiền thu từ đối tác (PT)”, chọn đúng khoản chưa trả hết và nhập số tiền, nhớ chọn đúng quỹ tiền (két tiền mặt hoặc tài khoản ngân hàng) để số dư quỹ tự cập nhật.",
      "Tạo đợt chốt sổ (DS) theo kỳ cho từng nhà cung cấp hoặc đối tác: chọn kỳ và tick các khoản chưa trả hết để chốt số với bên kia.",
      "Ở Phải thu đối tác, khoản quá hạn được tô đỏ ở cột Hạn thu kèm chữ “(quá hạn)” — ưu tiên nhắc đối tác thanh toán theo số ngày thanh toán đã khai báo ở hồ sơ đối tác.",
    ],
  },
  {
    id: "accounting-bao-cao-gioi-han",
    title: "Báo cáo, xuất CSV & giới hạn của vai trò Kế toán",
    roles: ["ACCOUNTING"],
    points: [
      "Vào Báo cáo để xem đối chiếu hàng ký gửi theo nhà cung cấp và theo đối tác (số đã gửi phải bằng số đã bán + đã trả lại + còn giữ), kèm nút “Xuất CSV” ở đầu mỗi phần khi cần gửi số liệu ra ngoài.",
      "Ở Tổng quan, vai trò Kế toán xem được biểu đồ Doanh thu – Giá vốn – Lãi theo kỳ đã chọn (mặc định 90 ngày), biểu đồ 3 vòng tồn kho theo giá vốn, tiền nợ theo tình hình trả và tiền phải thu theo thời gian quá hạn — dùng các số này cho việc theo dõi dòng tiền và tiền nợ. Doanh thu hiển thị chưa tách thuế GTGT.",
      "Giới hạn: Kế toán không sửa kho trực tiếp và không tạo phiếu nhập / xuất kho — mọi biến động kho phải đi qua chứng từ do Kho hoặc Chủ cửa hàng lập và xác nhận. Chứng từ đã xác nhận hiện không sửa hay đảo trực tiếp được — sai sót xử lý bằng chứng từ trả hàng hoặc chứng từ điều chỉnh phù hợp theo hướng dẫn của kế toán.",
    ],
  },

  // ------------------------------------------------------------------ CEO
  {
    id: "ceo-tong-quan",
    title: "Xem Tổng quan điều hành",
    roles: ["CEO"],
    points: [
      "Mở Tổng quan để nắm bức tranh toàn cảnh: biểu đồ Doanh thu – Giá vốn – Lãi theo kỳ đã chọn (mặc định 90 ngày), biểu đồ 3 vòng tồn kho theo giá vốn (sở hữu / vị trí / trạng thái), tiền nợ phải trả và phải thu theo tình hình trả, tiền phải thu theo thời gian quá hạn, top 5 sản phẩm bán chạy trong 30 ngày. Doanh thu hiển thị chưa tách thuế GTGT.",
      "CEO xem được cả giá vốn và lợi nhuận gộp — nhưng chỉ xem, không tạo, sửa, xác nhận hay xoá bất kỳ chứng từ hay dữ liệu nào.",
      "Chú ý các mục cảnh báo ở Tổng quan: “Hàng sắp hết” (tồn bằng hoặc dưới mức tối thiểu), “Lô ký gửi phải trả trong 30 ngày tới”, và bảng hàng gửi đối tác bị lệch số xuất hiện khi số đã gửi không khớp số đã bán + đã trả lại + còn giữ.",
    ],
  },
  {
    id: "ceo-bao-cao-chi-tiet",
    title: "Xem báo cáo & chi tiết số liệu",
    roles: ["CEO"],
    points: [
      "Vào Báo cáo để xem đối chiếu hàng ký gửi theo nhà cung cấp và theo đối tác; vào Phải trả nhà cung cấp / Phải thu đối tác để xem chi tiết tiền nợ, số đã thanh toán và hạn thanh toán; vào Hoá đơn GTGT (theo dõi nội bộ) để xem các hoá đơn đã ghi nhận.",
      "Vào Tồn kho theo lô để xem tồn kho chi tiết theo từng lô (sở hữu, nhà cung cấp, giá vốn, hạn trả); vào Sản phẩm để xem danh mục và tồn theo từng mặt hàng.",
      "Mọi danh sách và chứng từ đều mở xem được toàn bộ — dùng các bộ lọc ở đầu mỗi trang (sở hữu, vị trí, trạng thái) để thu hẹp phạm vi cần xem.",
    ],
  },
  {
    id: "ceo-chi-xem",
    title: "Vai trò CEO là chỉ xem",
    roles: ["CEO"],
    points: [
      "Vai trò CEO là CHỈ XEM ở cả giao diện lẫn cơ sở dữ liệu: bạn không tạo, sửa, xác nhận hay xoá bất kỳ chứng từ hay dữ liệu nào — các form và nút thao tác được ẩn khỏi giao diện, và cơ sở dữ liệu cũng không cấp quyền ghi cho vai trò này.",
      "Khi cần thay đổi số liệu, hãy đề nghị Chủ cửa hàng (OWNER) hoặc đúng vai trò phụ trách thực hiện: Kho phụ trách nhập/xuất và kiểm kho, Bán hàng phụ trách bán hàng và tiêu thụ, Kế toán phụ trách hoá đơn và tiền nợ.",
    ],
  },
];
