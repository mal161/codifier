export function Dashboard() {
  function PageTitle() {
    return <h1>Users</h1>;
  }

  function formatHeading(value: string) {
    return value.trim();
  }

  return <PageTitle />;
}
