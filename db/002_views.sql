create or replace view player_pool as
  select p.*, ph.storage_path as photo_path
  from players p
  left join photos ph on ph.player_id = p.id and ph.is_primary
  where p.active and p.quality->>'status' = 'pass';
