create policy "race_results_delete" on race_results for delete using (auth.uid() = user_id);
