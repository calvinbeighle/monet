import * as React from "react";

interface LoaderProps {
  size?: number;
  text?: string;
}

export const AiLoader: React.FC<LoaderProps> = ({ size = 180, text = "monet" }) => {
  const letters = text.split("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-b from-[#1a1a2e] via-[#0f0f1a] to-black">
      <div
        className="relative flex items-center justify-center font-inter select-none"
        style={{ width: size, height: size }}
      >
        {letters.map((letter, index) => (
          <span
            key={index}
            className="inline-block text-white text-2xl font-light tracking-widest opacity-40"
            style={{
              animation: 'loaderLetter 3s infinite',
              animationDelay: `${index * 0.1}s`
            }}
          >
            {letter}
          </span>
        ))}

        <div
          className="absolute inset-0 rounded-full"
          style={{ animation: 'loaderCircle 5s linear infinite' }}
        />
      </div>

      <style>{`
        @keyframes loaderCircle {
          0% {
            transform: rotate(90deg);
            box-shadow:
              0 6px 12px 0 #8b5cf6 inset,
              0 12px 18px 0 #6d28d9 inset,
              0 36px 36px 0 #4c1d95 inset,
              0 0 3px 1.2px rgba(139, 92, 246, 0.3),
              0 0 6px 1.8px rgba(109, 40, 217, 0.2);
          }
          50% {
            transform: rotate(270deg);
            box-shadow:
              0 6px 12px 0 #a78bfa inset,
              0 12px 6px 0 #7c3aed inset,
              0 24px 36px 0 #6d28d9 inset,
              0 0 3px 1.2px rgba(139, 92, 246, 0.3),
              0 0 6px 1.8px rgba(109, 40, 217, 0.2);
          }
          100% {
            transform: rotate(450deg);
            box-shadow:
              0 6px 12px 0 #c4b5fd inset,
              0 12px 18px 0 #8b5cf6 inset,
              0 36px 36px 0 #4c1d95 inset,
              0 0 3px 1.2px rgba(139, 92, 246, 0.3),
              0 0 6px 1.8px rgba(109, 40, 217, 0.2);
          }
        }

        @keyframes loaderLetter {
          0%, 100% {
            opacity: 0.4;
            transform: translateY(0);
          }
          20% {
            opacity: 1;
            transform: scale(1.15);
          }
          40% {
            opacity: 0.7;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};
