create table if not exists sources (
  id text primary key,
  licence text not null,
  url text,
  sha256 text,
  fetched_at timestamptz not null default now()
);

create table if not exists players (
  id bigserial primary key,
  slug text unique not null,
  name text not null,
  date_of_birth date not null,
  citizenship text[] not null default '{}',
  position text not null check (position in ('Goalkeeper','Defender','Midfielder','Forward')),
  sub_position text,
  preferred_foot text,
  height_cm smallint,
  international_caps int,
  international_goals int,
  highest_market_value_eur bigint,
  market_value_eur bigint,
  photo_id text,
  active boolean not null default false,
  quality jsonb not null default '{}'
);

create table if not exists player_sources (
  player_id bigint references players(id) on delete cascade,
  source_id text references sources(id),
  source_key text not null,
  primary key (player_id, source_id)
);

create table if not exists leagues (
  id text primary key,
  name text not null,
  display_name text not null
);

create table if not exists league_aliases (
  alias text primary key,
  league_id text references leagues(id)
);

create table if not exists clubs (
  id bigserial primary key,
  name text not null,
  country text,
  current_league_id text references leagues(id)
);

create table if not exists club_aliases (
  alias text primary key,
  club_id bigint references clubs(id)
);

create table if not exists tournaments (
  id text primary key,
  name text not null,
  year smallint not null,
  display_name text not null
);

create table if not exists club_stints (
  player_id bigint references players(id) on delete cascade,
  club_id bigint references clubs(id),
  season_start smallint not null,
  season_end smallint not null,
  evidence text not null check (evidence in ('appearance','transfer','wikidata','override')),
  source_id text references sources(id),
  primary key (player_id, club_id, season_start)
);

create table if not exists player_seasons (
  player_id bigint references players(id) on delete cascade,
  season smallint not null,
  club_id bigint references clubs(id),
  league_id text references leagues(id),
  primary key (player_id, season, club_id)
);
create index if not exists player_seasons_league_season_idx on player_seasons (league_id, season, player_id);
create index if not exists player_seasons_season_idx on player_seasons (season, player_id);

create table if not exists player_derived_stats (
  player_id bigint references players(id) on delete cascade,
  metric text not null,
  value numeric not null,
  window_start smallint,
  window_end smallint,
  exact boolean not null,
  source_id text references sources(id),
  primary key (player_id, metric)
);
create index if not exists player_derived_stats_metric_value_idx on player_derived_stats (metric, value);

create table if not exists windows (
  id text primary key,
  kind text not null check (kind in ('career','season','season_range','tournament','club_stint','age_band')),
  label text not null,
  detail text,
  season_start smallint,
  season_end smallint,
  tournament_id text references tournaments(id),
  club_id bigint references clubs(id),
  team_name text,
  age_from smallint,
  age_to smallint
);

create table if not exists player_window_stats (
  player_id bigint references players(id) on delete cascade,
  window_id text not null references windows(id),
  metric text not null,
  value numeric not null,
  exact boolean not null,
  source_id text references sources(id),
  primary key (player_id, window_id, metric)
);
create index if not exists player_window_stats_window_metric_idx on player_window_stats (window_id, metric);

create table if not exists player_tournaments (
  player_id bigint references players(id) on delete cascade,
  tournament_id text not null references tournaments(id),
  team_name text,
  source_id text references sources(id),
  primary key (player_id, tournament_id)
);
create index if not exists player_tournaments_tournament_idx on player_tournaments (tournament_id);

create table if not exists market_value_history (
  player_id bigint references players(id) on delete cascade,
  recorded_on date not null,
  value_eur bigint not null,
  source_id text references sources(id),
  primary key (player_id, recorded_on)
);

create table if not exists photos (
  id text primary key,
  player_id bigint references players(id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  licence text not null,
  attribution text,
  source_url text not null,
  source_id text references sources(id),
  is_primary boolean not null default false,
  fetched_at timestamptz not null default now()
);
create unique index if not exists photos_primary_idx on photos (player_id) where is_primary;

create table if not exists overrides (
  match_key text primary key,
  player_id bigint references players(id),
  note text,
  decided_by text,
  decided_at timestamptz not null default now()
);
