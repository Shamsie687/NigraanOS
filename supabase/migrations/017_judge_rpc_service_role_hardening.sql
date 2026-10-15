-- Apply ONLY after reviewed 015 and 016, before enabling judge requests/webhooks.
-- Remove inherited default EXECUTE on newly introduced judge helpers only.
-- No global defaults, permanent Operations helpers, data or policies are changed.
begin;
revoke all on function public.nigraan_is_permanent_operations(),
  public.nigraan_is_judge_admin(),public.nigraan_has_operations_access(),
  public.nigraan_operations_access_context(),public.nigraan_request_judge_access(),
  public.nigraan_decide_judge_access(uuid,text),public.nigraan_list_judge_requests(),
  public.nigraan_guard_operations_write(),public.nigraan_retry_judge_email(uuid),
  public.nigraan_storage_access_base(text,text),public.nigraan_claim_judge_email(uuid),
  public.nigraan_finish_judge_email(uuid,uuid,text,text) from service_role;
grant execute on function public.nigraan_claim_judge_email(uuid),
  public.nigraan_finish_judge_email(uuid,uuid,text,text) to service_role;
commit;
