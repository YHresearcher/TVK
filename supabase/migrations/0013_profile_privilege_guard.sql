-- 0013: Chặn tự nâng quyền qua chính sách RLS tự sửa dòng của profiles.
--
-- Chính sách pol_profiles_upd_self cho mọi tài khoản tự sửa dòng của mình
-- (để tự gỡ cờ bắt đổi mật khẩu ở lần đăng nhập đầu), nhưng không giới hạn
-- cột — tài khoản thường có thể tự đổi cả role/is_active/email qua API
-- trực tiếp rồi leo lên OWNER, vì current_app_role() đọc ngay dòng đó.
-- Trigger này chỉ cho Chủ cửa hàng đổi các cột nhạy cảm đó. Đường
-- service-role (máy chủ, qua admin client) luôn được qua vì auth.uid()
-- rỗng; tài khoản thường tự sửa chỉ được đổi họ tên, tên đăng nhập và gỡ
-- cờ bắt đổi mật khẩu.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Đường máy chủ (service-role): auth.uid() rỗng — mọi thao tác của
  -- Chủ cửa hàng qua admin client đều đi đường này, luôn cho qua.
  if auth.uid() is null then
    return NEW;
  end if;
  -- Chủ cửa hàng tự thao tác trực tiếp: cho qua hết.
  if current_app_role() = 'OWNER' then
    return NEW;
  end if;
  -- Tài khoản thường tự sửa dòng của mình: cấm đổi vai trò, trạng thái
  -- và email (danh tính đăng nhập). Họ tên, tên đăng nhập và cờ bắt
  -- đổi mật khẩu vẫn sửa được.
  if NEW.role is distinct from OLD.role
    or NEW.is_active is distinct from OLD.is_active
    or NEW.email is distinct from OLD.email then
    raise exception 'Chỉ Chủ cửa hàng mới được đổi vai trò, trạng thái hoặc email của tài khoản.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_profiles_privilege_guard on profiles;
create trigger trg_profiles_privilege_guard
  before update on profiles
  for each row execute function guard_profile_privileges();
