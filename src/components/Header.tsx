import Link from "next/link";
import { brandFont } from "@/app/brandFont";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 h-14 border-b border-white/10 bg-neutral-950/90 backdrop-blur">
      <div className="flex h-full items-center px-4">
        <Link
          href="/"
          className={`${brandFont.className} select-none leading-none`}
          style={{
            fontSize: "28px",
            letterSpacing: "0.02em",
            textShadow: "0 2px 10px rgba(190,255,60,0.18)",
          }}
        >
          <span style={{ color: "#C8FF2E" }}>Greed</span>
          <span style={{ color: "#7F8F63" }}>Seek</span>
        </Link>
      </div>
    </header>
  );
}
