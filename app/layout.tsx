import "./globals.css";
import { Tajawal } from "next/font/google";
import { ThemeProvider } from "next-themes";

const font = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "900"],
});

export const metadata = {
  title: "اليورو | لوحة الإدارة",
  description: "نظام إدارة اليورو وواجهات API الخاصة بالتطبيق",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${font.className} antialiased selection:bg-[#0A84FF]/30`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
