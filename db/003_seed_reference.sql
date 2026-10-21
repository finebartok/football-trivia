insert into leagues (id, name, display_name) values
  ('GB1','premier-league','Premier League'),
  ('ES1','laliga','La Liga'),
  ('IT1','serie-a','Serie A'),
  ('FR1','ligue-1','Ligue 1'),
  ('L1','bundesliga','Bundesliga'),
  ('NL1','eredivisie','Eredivisie'),
  ('PO1','liga-portugal','Primeira Liga'),
  ('MLS1','major-league-soccer','MLS'),
  ('SA1','saudi-pro-league','Saudi Pro League')
on conflict (id) do update set name = excluded.name, display_name = excluded.display_name;

insert into league_aliases (alias, league_id) values
  ('Premier League','GB1'), ('PL','GB1'), ('premier league','GB1'),
  ('La Liga','ES1'), ('Laliga','ES1'), ('LaLiga','ES1'), ('laliga','ES1'),
  ('Serie A','IT1'), ('SerieA','IT1'), ('serie a','IT1'),
  ('Ligue 1','FR1'), ('Ligue1','FR1'), ('ligue 1','FR1'),
  ('Bundesliga','L1'), ('Bundes Liga','L1'),
  ('Eredivisie','NL1'), ('Primeira Liga','PO1'), ('Major League Soccer','MLS1')
on conflict (alias) do update set league_id = excluded.league_id;

insert into tournaments (id, name, year, display_name) values
  ('wc-2022','2022 FIFA World Cup',2022,'2022 World Cup'),
  ('wc-2026','2026 FIFA World Cup',2026,'2026 World Cup'),
  ('euro-2024','UEFA Euro 2024',2024,'Euro 2024'),
  ('copa-2024','Copa America 2024',2024,'Copa América 2024')
on conflict (id) do update set name = excluded.name, year = excluded.year, display_name = excluded.display_name;
