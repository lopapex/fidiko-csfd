export function LoadNotice({
  message,
  warning,
  onRetry,
}: {
  message: string;
  warning: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={warning ? "load-notice warning" : "load-notice"} role="alert">
      <span>{warning ? `Zobrazuji poslední data. ${message}` : message}</span>
      <button type="button" onClick={onRetry}>
        Zkusit znovu
      </button>
    </div>
  );
}
