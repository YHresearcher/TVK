import { Card, NotConfigured, PageHeader } from "@/components/ui";
import ImportExcel from "@/components/ImportExcel";
import { importStockAction } from "@/lib/actions";
import {
  getCurrentProfile,
  listLocations,
  listProductCodes,
  listProducts,
  listSuppliers,
} from "@/lib/queries";
import { isReadOnlyRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const [suppliers, locations, products, codes, profile] = await Promise.all([
    listSuppliers(),
    listLocations(),
    listProducts(),
    listProductCodes(),
    getCurrentProfile(),
  ]);
  const configured = suppliers.configured;
  const readOnly = isReadOnlyRole(profile.data?.role);
  const warehouses = locations.data.filter(
    (l) => l.location_kind === "OWN_WAREHOUSE"
  );

  return (
    <>
      <PageHeader
        title="Nhập từ Excel"
        description="Nạp cả một danh mục giao hàng vào một phiếu nhập mua (PN) hoặc phiếu nhận ký gửi (NK). Một file = một phiếu của một nhà cung cấp; chọn loại phiếu, nhà cung cấp và kho ở trên trước khi xác nhận nhập."
      />
      {!configured && <NotConfigured />}
      {configured && readOnly && (
        <Card title="Nhập từ Excel">
          <p className="text-sm leading-relaxed text-slate-600">
            Vai trò CEO chỉ có quyền xem, không nhập dữ liệu. Trang này chỉ để
            theo dõi cấu trúc file chuẩn; khi cần nhập hàng, hãy nhờ vai trò
            Kho hoặc Chủ cửa hàng thực hiện ở chính trang này bằng tài khoản
            của họ.
          </p>
        </Card>
      )}
      {configured && !readOnly && (
        <div className="space-y-6">
          <Card title="Import phiếu nhập kho">
            <ImportExcel
              suppliers={suppliers.data}
              warehouses={warehouses}
              products={products.data.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
              }))}
              codes={codes.data.map((c) => ({
                code: c.code,
                product_id: c.product_id,
              }))}
              action={importStockAction}
            />
          </Card>
          <Card title="Cấu trúc file chuẩn">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>
                Các cột: <b>MaHang</b> (bắt buộc), MaThayThe (nhiều mã cách nhau
                bằng dấu “;”), TenHang, TenTiengAnh, ThuongHieu, DongXe,
                DonViTinh, <b>SoLuong</b>, GiaVonVND, GiaUSD, GiaBanDeXuat,
                GhiChu. Tên cột không phân biệt hoa thường và dấu.
              </li>
              <li>
                Giá vốn mỗi dòng: ưu tiên GiaVonVND; nếu để trống sẽ tính từ
                GiaUSD × tỷ giá × (1 + VAT%) theo thông số ở trên.
              </li>
              <li>
                Mã hàng khớp với SKU hoặc bất kỳ mã thay thế nào đã đăng ký thì
                vào sản phẩm đã có; mã chưa có sẽ được tự tạo (kèm mã thay thế
                và dòng xe) khi bật tuỳ chọn tự tạo.
              </li>
              <li>
                Hãy dùng nút “Tải file mẫu” để lấy đúng định dạng, và kiểm tra
                bảng xem trước (trạng thái từng dòng, tổng số lượng, tổng tiền)
                trước khi bấm “Xác nhận nhập”.
              </li>
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
