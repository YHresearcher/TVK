// Chuẩn mật khẩu mạnh — áp dụng cho mọi mật khẩu do người dùng TỰ ĐẶT
// (trang đặt mật khẩu qua link mời / đặt lại, và trang đổi mật khẩu bắt
// buộc). Mật khẩu tạm do Chủ cửa hàng cấp khi tạo tài khoản không qua
// chuẩn này, nhưng tài khoản đó bị gắn cờ must_change_password và phải
// đổi sang mật khẩu đạt chuẩn ngay ở lần đăng nhập đầu tiên.

export interface PasswordRule {
  id: string;
  label: string;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "length", label: "Ít nhất 12 ký tự", test: (pw) => pw.length >= 12 },
  { id: "lower", label: "Có ít nhất 1 chữ thường (a–z)", test: (pw) => /[a-z]/.test(pw) },
  { id: "upper", label: "Có ít nhất 1 chữ HOA (A–Z)", test: (pw) => /[A-Z]/.test(pw) },
  { id: "digit", label: "Có ít nhất 1 chữ số (0–9)", test: (pw) => /[0-9]/.test(pw) },
  {
    id: "symbol",
    label: "Có ít nhất 1 ký tự đặc biệt (ví dụ ! @ # $ % ^ & *)",
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

export function passwordRuleStates(pw: string) {
  return PASSWORD_RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(pw) }));
}

/** Danh sách yêu cầu CHƯA đạt; mảng rỗng nghĩa là mật khẩu đạt chuẩn. */
export function validatePassword(pw: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.label);
}
