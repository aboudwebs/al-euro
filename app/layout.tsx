import "./globals.css";
import { Tajawal } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { CartProvider } from "@/components/cart";
import Shell from "@/components/Shell";

const f = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "900"],
});

export const metadata = {
  title: "اليورو | قطع غيار ألمانية وأوروبية",
};

export default function L({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${f.className} antialiased selection:bg-[#0A84FF]/30`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <CartProvider>
            <Shell>{children}</Shell>
          </CartProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
