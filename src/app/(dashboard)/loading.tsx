// Khung chờ hiển thị ngay khi người dùng bấm chuyển trang, trong lúc
// máy chủ tải dữ liệu thật — tránh cảm giác trang bị "đơ".
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Đang tải">
      <div className="h-8 w-56 rounded bg-slate-200" />
      <div className="h-4 w-96 max-w-full rounded bg-slate-100" />
      <div className="h-64 rounded-xl bg-slate-100" />
    </div>
  );
}
