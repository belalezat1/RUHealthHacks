import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => api.dashboard(signal),
    refetchInterval: 3000,
  });
export function useAction<T, V = void>(action: (values: V) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () => client.invalidateQueries(),
    retry: false,
  });
}
