// Shared by the health dashboard (client) and the daily briefing job (server).
// Manual GHL location ID → Stripe customer ID overrides.
// Used when auto-matching (email/phone/name) fails due to data inconsistencies
// between GHL and Stripe (different contact emails, name variations, etc.).
// Priority: Cliff's sheet → these overrides → Stripe metadata → email → name → phone.
export const MANUAL_LOC_TO_CUST = {
  'mlf5bQzFhF3lxeyrekKM': 'cus_UpyBvugEpAOzt1', // Ana Alvarez
  'PO3oiOr3SB7B2pFINE4e': 'cus_UTSrspbT4W6TPJ', // Angel Alfred Najar
  'Hu2SAV4L661GRSMchLhi': 'cus_TWetgnBH8VvRZH', // Ashlynne Elrod Pushee
  'x2MlzNrhGpm0QknRAYpa': 'cus_Uz0w4Imdhs1xpe', // Charmagne Parker
  'nub1s1txx5gns0FdQYpt': 'cus_UGOUmOB4DSIkpT', // Cory Washam
  'Hzp2YEU5O8hRXkSDhPDU': 'cus_Unl8AyA9owPIcl', // Daniel Valdez
  'jfUXHS7u55gJfsnmZnaY': 'cus_T1tmQMPIl8Pr53', // David Huntley
  'MGwDBEhvgPaCB4cmVPZy': 'cus_UpvfKDEig0Z7io', // Flores Agency → Jose Flores
  'Zs4TN6xMTEnxAF1PnhqK': 'cus_UvbjdTifMqLsRA', // Gail Mirchandani
  'oMKDUZDit5o7gO6XVZUr': 'cus_UQXISuKUQ2uUzK', // Gerald Cummings
  '1doWoVuSH2bDGwzpQj7s': 'cus_UwMKuHEop8C8MR', // Justin Wilson
  'Ob4OLJALqFZcQBtFgPJb': 'cus_U0z9pLIXSFsHtn', // Kahl Insurance Agency
  'gdMsXRnC1F5h5xUdcQQT': 'cus_UCYLpyz1S5dUzm', // Kurt Haddock District Office
  'n22YswtEDJ7aeCLmgv0t': 'cus_So2jd7lAtTJZQl', // Les Palcsik (Leslie N Palcsik)
  '2KO3cImKm53ROl6oGrTg': 'cus_ULfrTQbu2zRNZW', // Luis Cortez
  'qb18A53QB0HF0bBob52d': 'cus_UTrw8xlTNUfJXi', // Nicolas Gwyn
  'tEyhikNKcsoHn0jqegxA': 'cus_S6EOt3M0E1ejqv', // Peter Raschio
  'rXnFUYrXyM0HAtZqoE1F': 'cus_QIH1QM93K4JygX', // Prospera NW Consulting Group
  'F5GAwcnB42JDWiV2sieb': 'cus_TF4omavbLkJc78', // Rappa District Office
  'r0inx3zRUkDjR17zARmM': 'cus_RTImIzHEYnsGm1', // Sean Verhoeff
  'WEf0nt2zV2opHao5bUTt': 'cus_Rqa1qbCdmepZ20', // Toni Begic
  '6v7IXovjffVw6TaILwPQ': 'cus_P5EFcRcW0CzzQg', // The Waldron Agency
  'l3qJBTDFDARPxyfRhTzh': 'cus_QUHFLckQdO0lEr', // Walters Meis Agency
  'NEbEmdI23GC0ZGB2eJcM': 'cus_Tn9HfsNYHOoXSE', // Alex at Farmers → Alex Andrews
  'dvUbkdW8VLflHuZ9N3KK': 'cus_ThAbs9GewxyCds', // Virginia District 61 (confirmed by Cliff)
  'QHBIwZQeg1cYHFRUm38K': 'cus_PapSBPUVk47eaI', // Rikki Wilkerson Farmers (confirmed by Cliff)
  // From Cliff's LC Audit WS Pack Snapshot (2026-08-31):
  'p5ZScDfio2eKwcvnXJ37': 'cus_UQSfxDYJNhetzC', // Ashley Atkinson
  'OqziJmqncZXK59l7YCQT': 'cus_UBTXOcnopFXB8d', // Blake Jordan
  'lYA78yZwn2GhOBLxhzJX': 'cus_U57cZn7yShe0JP', // Brandi Clark
  'rmbDFqgko1SbYd5yQhOg': 'cus_SE8AWGK5lHlI3y', // Jeremiah/Taylor District
  'ZS6HDc70FathkNxMwriI': 'cus_Pmon8MVNyNn6XD', // Leo Gibson Farmers Agency
  'aqdohx8mNwHV6EpfWewQ': 'cus_Ts3pIDHTPW6AsD', // Robert Lafler
  'yVeQhP4kwqYp2oK4kJrB': 'cus_UsyBlzaNFMXJQ3', // StClair Agency
  'WW8hlI5uJg0qB8etlSoX': 'cus_UJKbDQQdPzLASO', // The Wood Agency (confirmed in both Cliff files)
}
