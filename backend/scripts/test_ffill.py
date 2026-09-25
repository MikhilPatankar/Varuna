import pandas as pd
import numpy as np

# Mocking the dataframe
data = {
    'lat': [41.843, 41.921, 42.032, 42.123, 42.364, 42.351],
    'lon': [17.239, 17.252, 17.298, 17.396, 17.664, 17.934],
    'observation_time': [
        "2026-09-21 00:02:20",
        "2026-09-16 18:04:30",
        "2026-09-10 20:34:20",
        "2026-09-06 14:05:30",
        "2026-08-31 16:04:20",
        "2026-08-27 10:04:30"
    ],
    'qc_flag': [0]*6
}

df = pd.DataFrame(data)
print("Original DF:")
print(df)

df['obs_dt'] = pd.to_datetime(df['observation_time'])
df = df.sort_values('obs_dt', ascending=True)
df['day'] = df['obs_dt'].dt.floor('D')
df = df.drop_duplicates(subset=['day'], keep='last')
df.set_index('day', inplace=True)

min_day = df.index.min()
max_day = df.index.max()
full_range = pd.date_range(start=min_day, end=max_day, freq='D')

df = df.reindex(full_range)
df = df.ffill()

# Update observation_time to the index day
df['observation_time'] = df.index.strftime('%Y-%m-%d %H:%M:%S')

df = df.sort_index(ascending=False)
df = df.reset_index(drop=True)
df.drop(columns=['obs_dt'], inplace=True, errors='ignore')

print("\nFilled DF:")
print(df.head(10))
print(df.tail(10))
