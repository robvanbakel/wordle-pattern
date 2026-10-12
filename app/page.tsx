import { Suspense } from "react";
import { Explorer } from "./_components/Explorer";

export default function ExplorerPage() {
  return (
    <Suspense>
      <Explorer />
    </Suspense>
  );
}
