export function ToastViewport({ toast }) {
  if (!toast) {
    return null;
  }

  return <div className={`toast toast-${toast.type}`}>{toast.message}</div>;
}
