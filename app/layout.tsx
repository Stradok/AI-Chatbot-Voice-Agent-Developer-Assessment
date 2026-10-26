import "./globals.css";

export const metadata = {
  title: "PlacidWay Assistant",
  description: "Answers from PlacidWay pages about ITC Immunity Therapy Center, with sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
