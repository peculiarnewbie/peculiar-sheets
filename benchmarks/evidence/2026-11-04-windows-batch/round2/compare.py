import json,sys,statistics,random
rng=random.Random(12345)
a=json.load(open(sys.argv[1]))['results']
for file in sys.argv[2:]:
 b=json.load(open(file))['results']
 for scenario in ['batch-writes','offscreen-writes']:
  x=[r['writes']['completionDurationMs'] for r in a if r['implementation']=='peculiar-sheets' and r['scenario']==scenario]
  y=[r['writes']['completionDurationMs'] for r in b if r['implementation']=='peculiar-sheets' and r['scenario']==scenario]
  diffs=sorted(statistics.median(rng.choices(x,k=len(x)))-statistics.median(rng.choices(y,k=len(y))) for _ in range(20000))
  print(file,scenario,'median reduction',statistics.median(x)-statistics.median(y),'bootstrap95',diffs[500],diffs[19499])
