import { Suspense } from "react";

import { CalendarView } from "./calendar-view";

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarView />
    </Suspense>
  );
}
