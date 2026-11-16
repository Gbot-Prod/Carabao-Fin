// Q1a: shown for unknown URLs and when a page calls notFound().
import ErrorState from "@/components/ErrorState/ErrorState";

export default function NotFound() {
  return <ErrorState kind="notFound" />;
}
