from opendrift.models.oceandrift import OceanDrift
from datetime import datetime, timedelta

o = OceanDrift(loglevel=20)
o.add_readers_from_list([])  # senza forzanti reali → deriva solo per diffusione                                                                 
o.seed_elements(lon=12.5, lat=44.0, number=100, radius=1000, time=datetime.now())
o.run(duration=timedelta(hours=24), time_step=3600) 
#o.plot()                      
#o.export_netcdf('out/output.nc')                                            
                                                                             
