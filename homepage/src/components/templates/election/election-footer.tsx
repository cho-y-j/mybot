import type { SiteData } from "@/types/site";

interface Props {
  settings: SiteData["settings"];
  candidateName: string;
}

export default function ElectionFooter({ settings, candidateName }: Props) {
  return (
    <footer className="bg-gray-900 px-6 py-10 text-center pb-24">
      <div className="mx-auto max-w-3xl space-y-3">
        {settings.partyName && (
          <p
            className="text-sm font-bold"
            style={{ color: "var(--primary)" }}
          >
            {settings.partyName}
          </p>
        )}
        <p className="text-base font-bold text-white">
          {settings.positionTitle
            ? `${settings.positionTitle} ${candidateName}`
            : candidateName}
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          본 사이트는 선거 홍보 목적으로 제작되었습니다.
          <br />
          공직선거법을 준수하여 운영됩니다.
        </p>
        <p className="pt-2 text-xs text-gray-600">
          Powered by <span className="font-semibold">MyHome</span>
        </p>
      </div>
    </footer>
  );
}
