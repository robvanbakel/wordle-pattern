import { Suspense } from "react";
import { WordLens } from "./WordLens";

export default function WordPage() {
  return (
    <Suspense>
      <WordLens />
    </Suspense>
  );
}
