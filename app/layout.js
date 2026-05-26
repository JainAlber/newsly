import "./globals.css";

export const metadata = {
  title: "Newsly",
  description: "Your daily AI news briefing",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
