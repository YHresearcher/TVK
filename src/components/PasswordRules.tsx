import { passwordRuleStates } from "@/lib/password-policy";

/** Checklist trực quan: các yêu cầu của chuẩn mật khẩu mạnh, tick xanh khi đạt. */
export default function PasswordRules({ password }: { password: string }) {
  const states = passwordRuleStates(password);
  return (
    <ul className="space-y-1 text-xs">
      {states.map((s) => (
        <li key={s.id} className={s.ok ? "font-medium text-green-600" : "text-slate-500"}>
          {s.ok ? "✓" : "•"} {s.label}
        </li>
      ))}
    </ul>
  );
}
