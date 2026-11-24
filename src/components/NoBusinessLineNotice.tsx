/**
 * Thông báo khi tài khoản chưa được gán ngành hàng nào (ngữ cảnh NONE,
 * P2 fail-closed). Các trang liệt kê hiển thị khối này thay cho dữ
 * liệu — không gọi list* khi chưa có ngành.
 */
export default function NoBusinessLineNotice() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="font-medium text-amber-800">
        Tài khoản chưa được gán ngành hàng
      </p>
      <p className="mt-1 text-sm text-amber-700">
        Tài khoản của bạn chưa thuộc ngành hàng nào nên chưa xem được dữ
        liệu. Hãy nhờ chủ cửa hàng gán ngành (Cài đặt → Ngành hàng của
        tài khoản).
      </p>
    </div>
  );
}
