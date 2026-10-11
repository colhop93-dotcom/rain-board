/* Plain words shared by both map views. Uses the existing tap-to-open why handler. */
(function () {
  "use strict";
  var entries = {
  "ensemble_hourly": [
    "Hourly rain in the ensembles",
    "One cell counts model runs with at least 0.01 inch of precipitation in exactly that hour, pooled across all four ensembles including control runs. The denominator is the pooled member count, not the number of models. Labels show the Central clock (America/Chicago) at the start of the hour, including daylight time, inside tomorrow's station market day from midnight to midnight local standard time. Tap or hover for counts, the station-local hour and exact UTC boundaries. Phoenix has no station-local daylight shift. A missing ensemble, member value or ambiguous hour makes that hour unavailable. This is model agreement, not a probability measured on our gauges. It is unmeasured on our gauges, display only, and feeds nothing: no board forecast, trading decision or bot. It reuses the same Open-Meteo ensemble response and 30 minute cache."
  ],
  "v3": [
    "v3 forecast",
    "The board's v3 model estimates the chance the gauge reaches 0.01 inch within the contract day. It reads physics_v3.json and dated gauge evidence. The browser checks the file each minute; the file age is shown. It is not an observed total or a guarantee. The page does not identify every upstream model input."
  ],
  "market": [
    "Market / YES bid and ask",
    "Kalshi prices show what buyers offer and sellers ask for YES. The board reads market snapshots, not a weather model. Today quotes have age checks; Tomorrow snapshots are normally collected every 20 minutes. A price is not a measured rain chance or a promise you can trade at that price now."
  ],
  "record": [
    "Model record",
    "The v3 record comes from the reliability data loaded with the board. It describes results on the named unseen dates and probability bucket. Freshness follows that file and the named model version, not radar scans. Unmeasured means no matching record is available. It is not proof the next call will be right."
  ],
  "value": [
    "Value and market differences",
    "These rows compare the board v3 forecast with Kalshi prices and the candidate file. They refresh when the board reloads, normally each minute. A difference in points is a disagreement, not certain profit. The page cannot establish every rule used by the candidate writer."
  ],
  "sentinel": [
    "Rain Sentinel",
    "This panel reads sentinel.json for current weather statistics and status. The browser checks each minute and shows feed age. The board says when no validated Sentinel forecast exists. Statistics and nearby weather are not a validated rain probability."
  ],
  "nbm": [
    "Board / Tomorrow NWS numbers",
    "These are the same peak chance and amount used by Tomorrow, from tomorrow.json. Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. The Models panel shows them only when the file confirms the exact UTC window. Every number is unmeasured on our gauges. These display rows do not feed the bots. The collector uses NWS hourly forecasts and NWS forecast grids. It normally writes every 20 minutes. Peak means the largest hourly chance in the contract window, not whole-day chance. The page does not identify this number as a direct NBM blend output."
  ],
  "refl": [
    "Reflectivity / radar",
    "Colors show how strongly rain, ice or other objects reflect the radar beam. The broad map uses NOAA MRMS, a combined radar picture, normally every 2 minutes. Older long loops use the Iowa Environmental Mesonet (IEM) N0Q combined picture. Zooming near a picked gauge can use IEM NEXRAD Level III N0B. Local scans are several minutes apart; read the displayed time. An echo is not a gauge total or proof rain reached the ground."
  ],
  "smooth": [
    "Smooth radar drawing",
    "The browser smooths the radar signal between pixels, then uses the source colors again. This applies to MRMS, IEM N0Q, local N0B and HRRR pictures. It uses the same frame and timestamp as the unsmoothed source. Smoothing runs automatically where supported. It adds no observations or real detail between radar pixels."
  ],
  "play": [
    "Radar play, pause and frame slider",
    "Play walks through past radar, NOW, then HRRR predicted echoes from IEM. Past pictures come from NOAA MRMS or IEM N0Q; future pictures are HRRR model guesses. Radar updates every few minutes; HRRR normally has hourly runs. Each frame shows its own valid time and future run. Future frames are not radar observations. Pause and the slider only choose a picture."
  ],
  "prev": [
    "Previous / next radar frame",
    "These buttons move one frame backward or forward on the same timeline. The source is MRMS or IEM N0Q in the past, and IEM HRRR in the future. The displayed frame time determines freshness. Moving forward does not turn a model guess into observed radar."
  ],
  "now": [
    "NOW",
    "NOW selects the newest observed radar frame held by this page, from NOAA MRMS. The mosaic normally updates every 2 minutes. The displayed scan time matters; a fallback may have an unknown scan time. NOW does not mean a new scan was taken at the moment you tapped."
  ],
  "speed": [
    "Radar speed",
    "Speed changes how quickly the browser plays the frames. The pictures still come from MRMS, IEM N0Q and HRRR with their original times. It fetches no fresher weather by itself. Faster playback does not mean storms are moving faster."
  ],
  "loop": [
    "Radar loop length",
    "Loop chooses how much observed history to play. Recent history is NOAA MRMS; longer history uses IEM N0Q composite radar. Radar pictures are normally several minutes apart; read their timestamps. A longer loop is older evidence, not a longer weather forecast."
  ],
  "daa": [
    "1-hour rain",
    "This estimates rain added up in the hour before the image was made. IEM combines NEXRAD Level III DAA rain estimates. IEM normally makes a picture every 5 minutes; the board uses its file timestamp. It is a radar estimate, not the official gauge reading or next-hour forecast."
  ],
  "dta": [
    "Storm total",
    "This estimates rain since each radar started its storm total. IEM combines NEXRAD Level III DTA estimates, normally every 5 minutes. The board uses the file timestamp. Radars can start and reset at different times. This is not a midnight-to-midnight gauge total or a forecast."
  ],
  "eet": [
    "ECHO TOPS",
    "This shows the height of radar echoes in thousands of feet. IEM combines NEXRAD Level III EET echo tops, normally in 5-minute slots. The board reads the image metadata or file timestamp. It shows storm height, not rain rate, cloud height measured at the gauge, or a rain total."
  ],
  "vel": [
    "Velocity",
    "This shows motion toward or away from one radar after estimated storm motion is removed. The source is IEM NEXRAD Level III N0S; speed levels come from that scan in the Unidata archive. Scans are normally several minutes apart; scans over 30 minutes old are hidden. It is not ground wind speed, rainfall, or a tornado confirmation. Pick a gauge and zoom in to see its radar."
  ],
  "warnings": [
    "Warnings",
    "Outlines come from active NWS alerts at api.weather.gov. The board includes flood, flash flood, severe thunderstorm and tornado warnings, and checks every 5 minutes while visible. Alerts without a polygon cannot draw an outline. An empty map is not proof there are no hazards or other warnings."
  ],
  "fcst": [
    "Forecast mode / NDFD 72 h",
    "This replaces radar with NWS National Digital Forecast Database grids for up to 72 hours. The browser checks the NOAA service time list every 5 minutes. The service does not publish an issue time here, so forecast age is unknown. The selected time is when the forecast applies. These are forecasts, not observed radar or weather.com Premium data."
  ],
  "pop12": [
    "Forecast rain chance",
    "This shows NWS NDFD rain chance for each 12-hour period, in percent. NOAA supplies the grids; the page checks available times every 5 minutes. Issue age is unknown here. This is not an hourly chance or a gauge measurement."
  ],
  "qpf": [
    "Forecast rain amount",
    "This shows the precipitation NWS NDFD expects in each 6-hour period, in inches. NOAA supplies the grids; available times are checked every 5 minutes. Issue age is unknown here. It is not rain already measured or a full-day total."
  ],
  "sky": [
    "Forecast clouds",
    "This shows the percentage of sky NWS NDFD predicts will be covered by clouds. NOAA supplies the grids; available times are checked every 5 minutes. Issue age is unknown here. It is not a current satellite photograph or a rain chance."
  ],
  "wind": [
    "Forecast wind",
    "This shows sustained wind predicted by NWS NDFD. White arrows point where wind is going. Colors use knots; 1 knot is about 1.15 mph. NOAA times are checked every 5 minutes; issue age is unknown here. It is not radar velocity or a current wind reading."
  ],
  "gust": [
    "Forecast gusts",
    "This shows brief peak wind speeds predicted by NWS NDFD, in knots. NOAA times are checked every 5 minutes; issue age is unknown here. It is not sustained wind, radar velocity, or a measured gust."
  ],
  "fcplay": [
    "Forecast play / time slider",
    "Play and the slider choose successive NWS NDFD valid times, up to 72 hours. The NOAA time list is checked every 5 minutes; issue age is unknown here. Rain chance covers 12-hour periods and amount covers 6-hour periods. Animation is a series of predictions, not a radar movie."
  ],
  "clouds": [
    "GOES clouds on / off",
    "This adds NOAA GOES East and West infrared satellite images through nowCOAST. Brighter areas have colder, usually higher cloud tops. Images normally arrive every 5 minutes, about 4 minutes behind. Read the satellite time. Clouds step aside in forecast mode. It is not visible-light photography, rainfall, or a forecast."
  ],
  "opacity": [
    "Radar opacity",
    "This changes how transparent the radar picture is over the map. It uses the same MRMS, IEM radar or HRRR frame and timestamp. It does not refresh weather or change radar strength. With satellite clouds on, radar is drawn at full strength to preserve source colors."
  ],
  "key": [
    "Show radar key",
    "The key explains colors for the picture currently drawn, using its source colors and units. Sources include NOAA MRMS, IEM NEXRAD, HRRR and NDFD. It follows the selected frame, not a separate new reading. Matching a color is not a gauge measurement."
  ],
  "layers": [
    "Layers / map style / stations / photos",
    "Layers opens the picture and overlay choices. Map styles come from Esri; station markers use board data and photos use camera feeds. Each weather layer keeps its own timestamp; the board normally reloads data each minute. Hiding a layer or changing the background changes visibility, not the weather forecast. Photos are not rain measurements."
  ],
  "hours": [
    "Today by the hour / choose forecast hour",
    "This combines dated NWS and weather.com hourly forecasts, HRRR predicted echoes, and gauge wet hours held by the board. The browser checks board files each minute; provider updates can be older. Choose an hour to read its source and time. Blue marks recorded rain; amber marks predicted echoes. A predicted echo percentage is not a calibrated rain probability."
  ],
  "nws": [
    "NWS peak / wet window",
    "This shows the largest NWS hourly chance and hours with forecast rain signals from the board files. The browser checks each minute; use the displayed forecast fetch time for age. It is not a whole-day probability. A window is a timing hint, not a promise rain starts then."
  ],
  "twc": [
    "weather.com day / best hour",
    "The board shows weather.com daily or hourly rain chances and forecast amounts from its cached station feeds. The browser reloads each minute; read the feed timestamps for age. A best-hour chance is not a whole-day chance. An hourly accumulation observation is not proof it is raining right now."
  ],
  "hrrr": [
    "HRRR echo numbers",
    "These numbers describe predicted radar echoes from the station HRRR data held by the board. HRRR normally runs hourly; read the cached run and valid times. The browser checks board data each minute. The page does not establish the full upstream extraction method. Echo coverage is not a calibrated chance the gauge will record rain."
  ],
  "seven": [
    "7 models / amount forecasts",
    "This row shows per-model precipitation amounts and the count predicting at least 0.01 inch from the board model file. The browser checks the file each minute. The page does not establish every upstream provider or run schedule. Agreement is not a measured probability, and the record is unmeasured on this box."
  ],
  "brief": [
    "Station briefing / before and after cutoff",
    "This displays the cached NWS point forecast, airport forecast and forecaster discussion from the briefing file. Airport forecasts are called TAFs. The board checks each minute; source issue times are shown in the briefing. After-cutoff rain does not count for today. A regional discussion is not a gauge reading."
  ],
  "best_match": ["Best match (Open-Meteo's pick)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. This row shows the largest hourly precipitation chance and the sum of hourly precipitation in that window. Peak hourly chance is not a whole-day probability. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots. In the US, Open-Meteo's best match and its GFS seamless blend use the HRRR for the first two days, so this row and the HRRR row usually show the same numbers: one forecast, not two that agree."],
  "ecmwf_ifs025": ["ECMWF (Europe, best 2 to 10 days)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. This row shows the largest hourly precipitation chance and the sum of hourly precipitation in that window. Peak hourly chance is not a whole-day probability. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "gfs_global": ["GFS (US global, own run)", "This row is the GFS global model alone, not Open-Meteo's seamless blend, which swaps in the HRRR for the first two days. Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. This row shows the largest hourly precipitation chance and the sum of hourly precipitation in that window. Peak hourly chance is not a whole-day probability. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "gfs_hrrr": ["HRRR (US, best 0 to 18 h)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. This row shows the largest hourly precipitation chance and the sum of hourly precipitation in that window. Peak hourly chance is not a whole-day probability. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots. In the US, Open-Meteo's best match and its GFS seamless blend use the HRRR for the first two days, so this row and the HRRR row usually show the same numbers: one forecast, not two that agree."],
  "icon_seamless": ["ICON (Germany)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. This row shows the largest hourly precipitation chance and the sum of hourly precipitation in that window. Peak hourly chance is not a whole-day probability. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "gem_seamless": ["GEM (Canada)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. This row shows the largest hourly precipitation chance and the sum of hourly precipitation in that window. Peak hourly chance is not a whole-day probability. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "ncep_nbm_conus": ["NBM (US blend)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. This row shows the largest hourly precipitation chance and the sum of hourly precipitation in that window. Peak hourly chance is not a whole-day probability. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "ncep_nam_conus": ["NAM (US regional)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. This row shows the largest hourly precipitation chance and the sum of hourly precipitation in that window. Peak hourly chance is not a whole-day probability. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "ensemble_ncep_gefs025": ["GEFS ensemble (US)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. Members are alternative model runs, including the control run. This row counts runs with at least 0.01 inch in that window and shows their median total. Member share is the share of model runs, not a measured probability. The median is the middle total, averaging the middle two for an even count. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "ensemble_ecmwf_ifs025": ["ECMWF ensemble (Europe)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. Members are alternative model runs, including the control run. This row counts runs with at least 0.01 inch in that window and shows their median total. Member share is the share of model runs, not a measured probability. The median is the middle total, averaging the middle two for an even count. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "ensemble_icon_seamless_eps": ["ICON ensemble (Germany)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. Members are alternative model runs, including the control run. This row counts runs with at least 0.01 inch in that window and shows their median total. Member share is the share of model runs, not a measured probability. The median is the middle total, averaging the middle two for an even count. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."],
  "ensemble_gem_global_ensemble": ["GEM ensemble (Canada)", "Tomorrow's market day is midnight to midnight local standard time, or 1 am to 1 am during daylight time. Phoenix has no daylight shift. Members are alternative model runs, including the control run. This row counts runs with at least 0.01 inch in that window and shows their median total. Member share is the share of model runs, not a measured probability. The median is the middle total, averaging the middle two for an even count. Open-Meteo supplies hourly data. The browser fetches on opening and caches for 30 minutes. Model runs update on different schedules; issue time is not supplied here. Missing or incomplete coverage stays unavailable. Every number is unmeasured on our gauges. None of these numbers feeds the bots."]
};
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c]; }); }
  function button(k) {
    var e = entries[k];
    return '<div class="forecast-help-item"><button type="button" class="st forecast-why" aria-expanded="false" data-help="' + esc(k) + '" data-why="' + esc(e[1]) + '">why: ' + esc(e[0]) + '</button></div>';
  }
  function group(title, keys) { return '<details class="forecast-help"><summary>' + esc(title) + '</summary>' + keys.map(button).join('') + '</details>'; }
  window.RainForecastHelp = {entries: entries, group: group};
  var mapKeys = ['refl','smooth','play','prev','now','speed','loop','daa','dta','eet','vel','warnings','fcst','pop12','qpf','sky','wind','gust','fcplay','clouds','opacity','key','layers'];
  ['live','airport'].forEach(function (k) { document.getElementById('forecast-help-' + k).innerHTML = group('Why: map and forecast controls', mapKeys); });
  document.getElementById('tomorrow-help').innerHTML = group('Why: Tomorrow numbers', ['nbm','market']);
  document.getElementById('models-help').innerHTML = group('Why: model comparison numbers', ['nbm', 'best_match', 'ecmwf_ifs025', 'gfs_global', 'gfs_hrrr', 'icon_seamless', 'gem_seamless', 'ncep_nbm_conus', 'ncep_nam_conus', 'ensemble_ncep_gefs025', 'ensemble_ecmwf_ifs025', 'ensemble_icon_seamless_eps', 'ensemble_gem_global_ensemble', 'ensemble_hourly']);
  var modelsHelp = document.getElementById('models-help');
  modelsHelp.querySelector('summary').insertAdjacentHTML('afterend', '<p class="note">Peak chance is the largest hourly chance, not a whole-day probability. Amount includes all precipitation. Every row uses midnight to midnight local standard time, which is 1 am to 1 am during daylight time. Ensemble member share counts model runs, not a measured probability. Missing or incomplete model values stay unavailable.</p>');
  document.getElementById('station-forecast-help').innerHTML = group('Why: station forecasts and hours', ['v3','market','record','nws','twc','hrrr','seven','hours','brief','sentinel']);
})();
