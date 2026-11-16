import bpy,sys,math,bmesh
from mathutils import Vector
argv=sys.argv[sys.argv.index('--')+1:]
GLB,OUT,VIEW,RES,SAMP=argv[0],argv[1],argv[2],int(argv[3]),int(argv[4])
MODE=argv[5] if len(argv)>5 else 'day'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
S=bpy.context.scene
N=lambda m:m.node_tree.nodes
def bsdf(m):return N(m).get('Principled BSDF')
def add_noise_bump(m,scale=40,strength=.15,dist=.02):
  nt=m.node_tree;b=bsdf(m)
  if b.inputs['Normal'].links:return
  tc=nt.nodes.new('ShaderNodeTexCoord');nz=nt.nodes.new('ShaderNodeTexNoise');nz.inputs['Scale'].default_value=scale;nz.inputs['Detail'].default_value=8
  bp=nt.nodes.new('ShaderNodeBump');bp.inputs['Strength'].default_value=strength;bp.inputs['Distance'].default_value=dist
  nt.links.new(tc.outputs['Object'],nz.inputs['Vector']);nt.links.new(nz.outputs['Fac'],bp.inputs['Height']);nt.links.new(bp.outputs['Normal'],b.inputs['Normal'])
def tint_var(m,c1,c2,scale=3):
  nt=m.node_tree;b=bsdf(m)
  tc=nt.nodes.new('ShaderNodeTexCoord');nz=nt.nodes.new('ShaderNodeTexNoise');nz.inputs['Scale'].default_value=scale
  r=nt.nodes.new('ShaderNodeValToRGB');r.color_ramp.elements[0].color=(*c1,1);r.color_ramp.elements[1].color=(*c2,1)
  nt.links.new(tc.outputs['Generated'],nz.inputs['Vector']);nt.links.new(nz.outputs['Fac'],r.inputs['Fac'])
  src=b.inputs['Base Color'].links[0].from_socket if b.inputs['Base Color'].links else None
  if src:
    mx=nt.nodes.new('ShaderNodeMix');mx.data_type='RGBA';mx.blend_type='MULTIPLY';mx.inputs['Factor'].default_value=1
    nt.links.new(src,mx.inputs['A']);nt.links.new(r.outputs['Color'],mx.inputs['B']);nt.links.new(mx.outputs['Result'],b.inputs['Base Color'])
  else:nt.links.new(r.outputs['Color'],b.inputs['Base Color'])
def textured_bump(m,strength=.3):
  nt=m.node_tree;b=bsdf(m)
  if not b.inputs['Base Color'].links:return
  src=b.inputs['Base Color'].links[0].from_node
  while src.type!='TEX_IMAGE' and src.inputs and src.inputs[0].links:src=src.inputs[0].links[0].from_node
  if src.type!='TEX_IMAGE':return
  bp=nt.nodes.new('ShaderNodeBump');bp.inputs['Strength'].default_value=strength;bp.inputs['Distance'].default_value=.02
  nt.links.new(src.outputs['Color'],bp.inputs['Height']);nt.links.new(bp.outputs['Normal'],b.inputs['Normal'])
for m in bpy.data.materials:
  b=bsdf(m)
  if not b:continue
  n=m.name.split('.')[0]
  b.inputs['Emission Strength'].default_value=0
  if n=='water':
    b.inputs['Base Color'].default_value=(.04,.42,.5,1);b.inputs['Transmission Weight'].default_value=0;b.inputs['IOR'].default_value=1.33;b.inputs['Roughness'].default_value=.015;b.inputs['Coat Weight'].default_value=1;b.inputs['Coat Roughness'].default_value=0;b.inputs['Subsurface Weight'].default_value=.3;b.inputs['Subsurface Radius'].default_value=(.2,.6,.8)
    nt=m.node_tree;tc=nt.nodes.new('ShaderNodeTexCoord');w=nt.nodes.new('ShaderNodeTexNoise');w.inputs['Scale'].default_value=1.2;w.inputs['Detail'].default_value=4
    bp=nt.nodes.new('ShaderNodeBump');bp.inputs['Strength'].default_value=.25;bp.inputs['Distance'].default_value=.05
    nt.links.new(tc.outputs['Object'],w.inputs['Vector']);nt.links.new(w.outputs['Fac'],bp.inputs['Height']);nt.links.new(bp.outputs['Normal'],b.inputs['Normal'])
    if MODE=='dusk':b.inputs['Emission Color'].default_value=(.1,.75,.85,1);b.inputs['Emission Strength'].default_value=1.2
  elif n=='glass':
    b.inputs['Base Color'].default_value=(.8,.88,.9,1);b.inputs['Transmission Weight'].default_value=1;b.inputs['Roughness'].default_value=.01;b.inputs['IOR'].default_value=1.5
  elif n=='poly':
    b.inputs['Transmission Weight'].default_value=.9;b.inputs['Roughness'].default_value=.35;b.inputs['Alpha'].default_value=1
  elif n in('leaf','frond','hedge','hedgeCore','bougain'):
    base=tuple(b.inputs['Base Color'].default_value[:3])
    if n=='hedge':base=(.12,.24,.07)
    if n=='bougain':tint_var(m,(.18,.3,.08),(.85,.08,.42),scale=9);b.inputs['Roughness'].default_value=.6;add_noise_bump(m,scale=60,strength=.4);continue
    if n=='frond':base=(.17,.24,.07)
    tint_var(m,tuple(c*.65 for c in base),tuple(min(1,c*1.25) for c in base),scale=6)
    b.inputs['Roughness'].default_value=.55;b.inputs['Subsurface Weight'].default_value=.08;b.inputs['Specular IOR Level'].default_value=.4
    add_noise_bump(m,scale=60,strength=.4)
  elif n=='grass':
    tint_var(m,(.55,.6,.45),(1.05,1.05,.9),scale=2);add_noise_bump(m,scale=180,strength=.5,dist=.03)
  elif n in('lime','white','render','villa'):
    b.inputs['Roughness'].default_value=.9;tint_var(m,(.93,.92,.89) if n!='render' else (.9,.9,.9),(1,1,1),scale=1.5);add_noise_bump(m,scale=25,strength=.08)
  elif n in('roof','drive','deck','pebble','timber','zellige'):
    textured_bump(m,.35 if n in('roof','pebble','drive') else .15)
    if n=='zellige':b.inputs['Roughness'].default_value=.12
  elif n=='steel':b.inputs['Metallic'].default_value=.9;b.inputs['Roughness'].default_value=.3
  elif n=='pv':b.inputs['Roughness'].default_value=.08;b.inputs['Specular IOR Level'].default_value=.8
  elif n in('lamp','glow') and MODE=='dusk':
    b.inputs['Emission Color'].default_value=(1,.72,.42,1);b.inputs['Emission Strength'].default_value=60 if n=='lamp' else 8
  elif n=='lamp' and MODE!='dusk':b.inputs['Base Color'].default_value=(1,.93,.8,1);b.inputs['Roughness'].default_value=.25;b.inputs['Transmission Weight'].default_value=.6
  elif n=='outside':b.inputs['Base Color'].default_value=(.5,.42,.3,1);tint_var(m,(.75,.7,.6),(1.05,1,.9),scale=.4);add_noise_bump(m,scale=8,strength=.2)
# bevel hard architectural blocks
ARCH={'lime','white','render','villa','stone','pebble','shutter','frame'}
for o in [o for o in bpy.data.objects if o.type=='MESH']:
  ms={s.material.name.split('.')[0] for s in o.material_slots if s.material}
  if ms&ARCH and len(o.data.vertices)<400:
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=1e-4);bm.to_mesh(o.data);bm.free()
    if o.data.has_custom_normals:
      try:o.data.free_normals_split()
      except Exception:pass
      bpy.context.view_layer.objects.active=o
      try:
        with bpy.context.temp_override(object=o,active_object=o,selected_objects=[o]):bpy.ops.mesh.customdata_custom_splitnormals_clear()
      except Exception as e:pass
    sc=max(o.scale);bv=o.modifiers.new('bev','BEVEL');bv.width=.015/max(sc,1e-3);bv.segments=2;bv.limit_method='ANGLE';bv.harden_normals=False
    o.data.shade_flat() if hasattr(o.data,'shade_flat') else None

# organic foliage: subdivide + displace low-poly canopy blobs
tex=bpy.data.textures.new('leafy','CLOUDS');tex.noise_scale=.35;tex.noise_depth=2
for o in [o for o in bpy.data.objects if o.type=='MESH']:
  ms={s_.material.name.split('.')[0] for s_ in o.material_slots if s_.material}
  if ms&{'leaf','bougain','hedge','hedgeCore'} and len(o.data.vertices)<2000:
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=1e-4);bm.to_mesh(o.data);bm.free()
    sd_=o.modifiers.new('sub','SUBSURF');sd_.levels=sd_.render_levels=3 if 'hedge' in ' '.join(ms) else 2
    if 'hedge' in ' '.join(ms):sd_.subdivision_type='SIMPLE'
    d=o.modifiers.new('disp','DISPLACE');d.texture=tex;d.texture_coords='GLOBAL';d.strength=.22/max(max(o.scale),.05);d.mid_level=.5
    o.data.shade_smooth()
# instanced grass blades on the lawn
lawn=[o for o in bpy.data.objects if o.name.startswith('Lawn')]
if lawn:
  lawn=lawn[0]
  bm=bmesh.new();v=[bm.verts.new(p) for p in((-.012,0,0),(.012,0,0),(.004,.01,.06),(0,.02,.11))];bm.faces.new(v[:3]);bm.faces.new((v[1],v[3],v[2]));bm.faces.new((v[0],v[2],v[3]))
  me=bpy.data.meshes.new('blade');bm.to_mesh(me);bm.free();blade=bpy.data.objects.new('blade',me);S.collection.objects.link(blade);blade.hide_render=True;blade.hide_viewport=True
  gmat=bpy.data.materials.new('blade');gmat.use_nodes=True;gb2=bsdf(gmat);gb2.inputs['Roughness'].default_value=.6;gb2.inputs['Subsurface Weight'].default_value=.1
  tint_var(gmat,(.06,.16,.03),(.2,.32,.07),scale=.6);me.materials.append(gmat)
  ng=bpy.data.node_groups.new('grass','GeometryNodeTree')
  ng.interface.new_socket('Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');ng.interface.new_socket('Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
  nn=ng.nodes;L=ng.links;gi=nn.new('NodeGroupInput');go=nn.new('NodeGroupOutput')
  dist=nn.new('GeometryNodeDistributePointsOnFaces');dist.inputs['Density'].default_value=float(argv[6]) if len(argv)>6 else 900
  inst=nn.new('GeometryNodeInstanceOnPoints');oi=nn.new('GeometryNodeObjectInfo');oi.inputs['Object'].default_value=blade
  rr=nn.new('FunctionNodeRandomValue');rr.data_type='FLOAT_VECTOR';rr.inputs['Min'].default_value=(-.35,-.35,0);rr.inputs['Max'].default_value=(.35,.35,6.28)
  rs=nn.new('FunctionNodeRandomValue');rs.data_type='FLOAT_VECTOR';rs.inputs['Min'].default_value=(.7,.7,.6);rs.inputs['Max'].default_value=(1.4,1.4,1.6)
  # lawn object may be scaled/rotated; compensate scale so blades are real-world size
  join=nn.new('GeometryNodeJoinGeometry')
  L.new(gi.outputs[0],dist.inputs['Mesh']);L.new(dist.outputs['Points'],inst.inputs['Points']);L.new(oi.outputs['Geometry'],inst.inputs['Instance'])
  L.new(dist.outputs['Rotation'],inst.inputs['Rotation']) if False else None
  L.new(rr.outputs[0],inst.inputs['Rotation']);L.new(rs.outputs[0],inst.inputs['Scale'])
  L.new(gi.outputs[0],join.inputs[0]);L.new(inst.outputs[0],join.inputs[0]);L.new(join.outputs[0],go.inputs[0])
  lawn.modifiers.new('grass','NODES').node_group=ng
  print('lawn',lawn.scale,lawn.rotation_euler,lawn.dimensions)

# big ground
bpy.ops.mesh.primitive_plane_add(size=30000,location=(0,0,-.03));g=bpy.context.object
gm=bpy.data.materials.new('farground');gm.use_nodes=True;gb=bsdf(gm);gb.inputs['Base Color'].default_value=(.5,.43,.32,1);gb.inputs['Roughness'].default_value=1;g.data.materials.append(gm);tint_var(gm,(.28,.2,.12),(.46,.35,.22),scale=.08);add_noise_bump(gm,scale=3,strength=.3)
# world / sun
w=bpy.data.worlds.new('sky');S.world=w;w.use_nodes=True;wn=w.node_tree.nodes;bg=wn['Background']
sky=wn.new('ShaderNodeTexSky');sky.sky_type='MULTIPLE_SCATTERING'
elev,az=(math.radians(24),math.radians(235)) if MODE=='day' else (math.radians(1.5),math.radians(250))
# az measured from +x (east) counter-clockwise; 235deg = south-west
sky.sun_elevation=elev;sky.sun_rotation=az-math.radians(90);sky.altitude=50;sky.sun_disc=False
w.node_tree.links.new(sky.outputs['Color'],bg.inputs['Color']);bg.inputs['Strength'].default_value=.17 if MODE=='day' else .5
sd=Vector((math.cos(elev)*math.cos(az),math.cos(elev)*math.sin(az),math.sin(elev)))
sun=bpy.data.lights.new('sun','SUN');sun.energy=5.2 if MODE=='day' else 1.0;sun.angle=math.radians(1.2)
sun.color=(1,.9,.78) if MODE=='day' else (1,.62,.38)
so=bpy.data.objects.new('sun',sun);S.collection.objects.link(so);so.rotation_euler=(-sd).to_track_quat('-Z','Y').to_euler()
if MODE=='dusk':
  for o in [o for o in bpy.data.objects if o.type=='MESH' and any(sl.material and sl.material.name.split('.')[0]=='lamp' for sl in o.material_slots)]:
    c=sum((o.matrix_world@Vector(v) for v in o.bound_box),Vector())/8
    pl=bpy.data.lights.new('pl','POINT');pl.energy=40;pl.color=(1,.7,.4);pl.shadow_soft_size=.05
    po=bpy.data.objects.new('pl',pl);S.collection.objects.link(po);po.location=c+Vector((0,0,.15))
# compute targets
def bbox(pred):
  lo=Vector((1e9,)*3);hi=Vector((-1e9,)*3)
  for o in bpy.data.objects:
    if o.type=='MESH' and pred(o):
      for c in o.bound_box:
        v=o.matrix_world@Vector(c);lo=Vector(map(min,lo,v));hi=Vector(map(max,hi,v))
  return lo,hi
plo,phi=bbox(lambda o:o.name.startswith('Swimming pool'))
pc=(plo+phi)/2;print('pool',plo,phi)
cam=bpy.data.cameras.new('cam');co=bpy.data.objects.new('cam',cam);S.collection.objects.link(co);S.camera=co
VIEWS={
 'aerial':((-45,-35,15),(-11,1,2.5),32),
 'aerial2':((14,-40,22),(-12,4,0),28),
 'pool':((pc.x+4,pc.y-9.2,1.6),(pc.x-3.5,pc.y+4,1.7),22),
 'drive':((-26.6,-11.6,1.65),(-24.5,10,1.9),24),
}
pos,tgt,lens=VIEWS[VIEW];co.location=pos;co.rotation_euler=(Vector(tgt)-Vector(pos)).to_track_quat('-Z','Y').to_euler();cam.lens=lens;cam.sensor_width=36
r=S.render;r.engine='CYCLES';r.resolution_x=RES;r.resolution_y=RES*9//16;r.film_transparent=False
S.cycles.samples=SAMP;S.cycles.use_denoising=True;S.cycles.use_adaptive_sampling=True;S.cycles.max_bounces=6;S.cycles.transmission_bounces=6;S.cycles.caustics_reflective=False;S.cycles.caustics_refractive=False
r.threads_mode='FIXED';r.threads=4
S.view_settings.view_transform='AgX'
for lk in('AgX - Medium High Contrast','Medium High Contrast','AgX - Base Contrast'):
  try:S.view_settings.look=lk;break
  except Exception:pass
S.view_settings.exposure=-.7 if MODE=='day' else -.35
r.image_settings.file_format='JPEG';r.image_settings.quality=90;r.filepath=OUT
bpy.ops.render.render(write_still=True)
print('DONE',OUT)
