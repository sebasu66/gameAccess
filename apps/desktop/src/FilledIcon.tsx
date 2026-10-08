/** Filled navigation silhouettes; size and color are defined in gameaccess-theme.css. */
export default function FilledIcon({ name }: { name: "search" | "catalog" | "library" | "genres" | "users" | "download" }) {
  const paths = {
    search: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm5 15 5 5a2 2 0 0 0 2-3l-5-5Z",
    catalog: "M2 2h9v9H2Zm11 0h9v9h-9ZM2 13h9v9H2Zm11 0h9v9h-9Z",
    library: "M2 3h5v19H2Zm7 0h5v19H9Zm7 1 5-1 3 18-5 1Z",
    genres: "M2 5h20v3H2Zm0 11h20v3H2ZM6 2h5v9H6Zm8 11h5v9h-5Z",
    users: "M8 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm10 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM1 21v-4a7 7 0 0 1 14 0v4Zm16 0v-4a9 9 0 0 0-1-4 6 6 0 0 1 8 5v3Z",
    download: "M10 2h4v9h5l-7 7-7-7h5ZM2 18h4v2h12v-2h4v5H2Z",
  };
  return <svg className="ga-filled-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d={paths[name]} /></svg>;
}
