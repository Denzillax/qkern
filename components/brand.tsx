import Image from "next/image";

type LogoProps = {
  variant?: "blue" | "white" | "dark";
  size?: "sm" | "md" | "lg";
  className?: string;
};

const logoWidths = { sm: 112, md: 142, lg: 190 };
const symbolWidths = { sm: 28, md: 34, lg: 44 };

export function QKERNLogo({ variant = "blue", size = "md", className }: LogoProps) {
  const width = logoWidths[size];
  return (
    <Image
      src={`/brand/qkern-logo-${variant}.svg`}
      width={width}
      height={Math.round(width / 5.22)}
      alt="QKERN"
      className={className}
      priority
    />
  );
}

export function QKERNSymbol({ variant = "blue", size = "md", className }: LogoProps) {
  const width = symbolWidths[size];
  return (
    <Image
      src={`/brand/qkern-symbol-${variant}.svg`}
      width={width}
      height={Math.round(width / 1.7)}
      alt="QKERN"
      className={className}
      priority
    />
  );
}
