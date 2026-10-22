/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Giữ bản sao phía trình duyệt của mỗi trang trong 30 giây: chuyển
    // qua lại giữa các tab gần như tức thì thay vì tải lại từ máy chủ.
    // Mọi thao tác ghi dữ liệu đều gọi revalidatePath nên trang liên quan
    // vẫn được làm mới ngay sau khi sửa.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
