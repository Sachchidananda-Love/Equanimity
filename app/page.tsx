import YiApp from "./YiApp";

export const dynamic = "force-dynamic";

export default function Page() {
  // This runs only at the server boundary; the serialized prop is reused by hydration.
  // eslint-disable-next-line react-hooks/purity
  return <YiApp initialNow={Date.now()} />;
}
