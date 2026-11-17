export default function PayCancelPage() {
  return (
    <main
      style={{
        maxWidth: 420,
        margin: "10vh auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ margin: "0 0 8px" }}>Checkout cancelled</h1>
      <p style={{ color: "#64748b", margin: 0 }}>
        No charge was made. You can try again from WordPress → Settings → WhatsApp.
      </p>
    </main>
  );
}
