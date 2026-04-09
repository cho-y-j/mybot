'use client';

interface Props {
  years: number[];
  value: number | null;
  onChange: (year: number) => void;
  showAggregateOption?: boolean;
  aggregateValue?: boolean;
  onAggregateChange?: (agg: boolean) => void;
}

export default function YearSelector({
  years,
  value,
  onChange,
  showAggregateOption = false,
  aggregateValue = false,
  onAggregateChange,
}: Props) {
  if (!years.length) return null;

  return (
    <div className="card">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-xs font-bold text-gray-700 dark:text-gray-300">📅 기준 회차</div>
          <div className="text-[11px] text-gray-500">선택한 회차의 결과만 표시됩니다</div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {showAggregateOption && (
            <button
              onClick={() => onAggregateChange?.(true)}
              className={`px-3 py-1.5 text-xs font-semibold rounded ${
                aggregateValue
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
              }`}
            >
              역대 누적
            </button>
          )}
          {years.map((y) => {
            const active = !aggregateValue && value === y;
            return (
              <button
                key={y}
                onClick={() => {
                  onAggregateChange?.(false);
                  onChange(y);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded ${
                  active
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                }`}
              >
                {y}년
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
