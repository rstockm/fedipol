const PARLIAMENT_QUERY = `
SELECT DISTINCT ?item ?itemLabel ?account ?party ?partyLabel ?position ?positionLabel WHERE {
  # Must have a Mastodon address
  ?item wdt:P4033 ?account .
  
  {
    # Either be member of a German party
    VALUES ?party {
      wd:Q49768     # SPD
      wd:Q49764     # CDU
      wd:Q49763     # CSU
      wd:Q49766     # FDP
      wd:Q49767     # Die Linke
      wd:Q49769     # Bündnis 90/Die Grünen
      wd:Q42575708  # Alternative für Deutschland
      wd:Q193178    # Piratenpartei Deutschland
      wd:Q1023134   # Die PARTEI
      wd:Q1387991   # Freie Wähler
      wd:Q2495321   # Volt Deutschland
      wd:Q119217039 # Bündnis Sahra Wagenknecht
    }
    { ?item wdt:P102 ?party }    # Party membership
    UNION
    { ?item wdt:P1416 ?party }   # Affiliations
    
    # And have a current political position
    ?item p:P39 ?positionStatement .
    ?positionStatement ps:P39 ?position .
    FILTER NOT EXISTS { ?positionStatement pq:P582 ?endtime }
  }
  UNION
  {
    # Or have an account on piraten-partei.social
    FILTER(CONTAINS(STR(?account), "piraten-partei.social"))
    
    # Optional party info for display
    OPTIONAL {
      { ?item wdt:P102 ?party }    # Party membership
      UNION
      { ?item wdt:P1416 ?party }   # Affiliations
    }
    
    # Optional position info for display
    OPTIONAL {
      ?item p:P39 ?positionStatement .
      ?positionStatement ps:P39 ?position .
      FILTER NOT EXISTS { ?positionStatement pq:P582 ?endtime }
    }
  }

  SERVICE wikibase:label { bd:serviceParam wikibase:language "de". }
}
ORDER BY ?itemLabel
` 