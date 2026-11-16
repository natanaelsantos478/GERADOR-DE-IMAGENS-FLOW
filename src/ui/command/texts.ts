/** pt-BR strings of the command UI (commanders, fatigue, equipment, weather). */
import { addTexts } from '../i18n';

const wx: Record<string, string> = {
  clear: 'Céu limpo', cloudy: 'Nublado', rain: 'Chuva', storm: 'Tempestade', snow: 'Neve', fog: 'Neblina', monsoon: 'Monção', heat: 'Calor extremo', dust: 'Tempestade de areia',
};
const d: Record<string, string> = {
  'ui.panel.command': 'Comando',
  'ui.cmd.title': 'Oficiais', 'ui.cmd.none': 'Sem oficiais neste país.', 'ui.cmd.warSupport': 'Apoio popular à guerra',
  'ui.cmd.warSupport.tip': 'Derrotas, baixas e ocupação reduzem o apoio; vitórias elevam. Apoio baixo gera agitação (aprovação e estabilidade); apoio alto acalma. Converge para a aprovação e a exaustão de guerra.',
  'ui.cmd.filter.all': 'Todos', 'ui.cmd.filter.land': 'Terra', 'ui.cmd.filter.naval': 'Mar', 'ui.cmd.filter.air': 'Ar',
  'ui.cmd.col.name': 'Oficial', 'ui.cmd.col.rank': 'Patente', 'ui.cmd.col.skills': 'ATQ/DEF/LOG/MAN', 'ui.cmd.col.traits': 'Traços', 'ui.cmd.col.post': 'Posto', 'ui.cmd.col.loyalty': 'Lealdade',
  'ui.cmd.free': 'disponível', 'ui.cmd.status.active': 'ativo', 'ui.cmd.status.wounded': 'ferido', 'ui.cmd.status.captured': 'capturado', 'ui.cmd.status.dead': 'morto/afastado',
  'ui.cmd.attack': 'Ataque', 'ui.cmd.defense': 'Defesa', 'ui.cmd.logistics': 'Logística', 'ui.cmd.maneuver': 'Manobra',
  'ui.cmd.attack.tip': '+3% de poder de ataque por ponto acima de 5.', 'ui.cmd.defense.tip': '+3% de defesa e menos perda de moral por ponto acima de 5.',
  'ui.cmd.logistics.tip': '+2% de suprimento e menos fadiga por ponto acima de 5.', 'ui.cmd.maneuver.tip': '+1,2% de velocidade; o lado com melhor manobra ganha +2% de poder por ponto de diferença.',
  'ui.cmd.exp': 'Experiência', 'ui.cmd.loyalty': 'Lealdade', 'ui.cmd.loyalty.tip': 'Lealdade baixa com estabilidade baixa leva generais a conspirar e eleva o risco de golpe.',
  'ui.cmd.record': 'Batalhas {b} · vitórias {w}', 'ui.cmd.history': 'Histórico', 'ui.cmd.noHistory': 'Sem registros.',
  'ui.cmd.assign': 'Designar', 'ui.cmd.unassign': 'Dispensar', 'ui.cmd.assignTo': 'Designar a uma formação', 'ui.cmd.pickFormation': 'Escolha a formação',
  'ui.cmd.commander': 'Comandante', 'ui.cmd.noCommander': 'Sem comandante (-7% ataque, -5% defesa)', 'ui.cmd.change': 'Trocar comandante', 'ui.cmd.fatigue': 'Fadiga', 'ui.cmd.readiness': 'Prontidão do material', 'ui.cmd.weather': 'Clima local',
  'ui.cmd.hist.promoted': 'Promovido', 'ui.cmd.hist.wounded': 'Ferido em combate', 'ui.cmd.hist.captured': 'Capturado', 'ui.cmd.hist.killed': 'Morto em combate', 'ui.cmd.hist.recovered': 'Recuperado', 'ui.cmd.hist.plot': 'Conspirou contra o governo', 'ui.cmd.hist.purged': 'Afastado após o golpe',
  'ui.cmd.fatigue.tip': 'Marcha, combate contínuo, frio/calor, lama e falta de suprimento aumentam a fadiga; descanso com suprimento recupera.',
  'ui.cmd.fatigue.eff': 'Velocidade {s}% · Poder de combate {p}%', 'ui.cmd.fatigue.mor': 'Acima de 60%: moral cai e recuperação de organização diminui.',
  'ui.cmd.ready.tip': 'O uso e o combate desgastam o material; manutenção em território amigo repõe (gasta dinheiro, aço e eletrônicos). Embargos e sanções pioram a manutenção.',
  'ui.cmd.ready.eff': 'Poder {p}% · Velocidade {s}%',
  'ui.cmd.wx.off': 'Velocidade fora de estrada', 'ui.cmd.wx.air': 'Operações aéreas (teto {c} m, visib. {v} km)', 'ui.cmd.wx.mud': 'Lama', 'ui.cmd.wx.temp': 'Temperatura', 'ui.cmd.wx.cause': 'Causa',
  'ui.cmd.wx.cause.mud': 'solo encharcado reduz a marcha fora de estrada e eleva o desgaste', 'ui.cmd.wx.cause.cold': 'frio extremo aumenta a fadiga', 'ui.cmd.wx.cause.heat': 'calor extremo aumenta a fadiga',
  'ui.cmd.wx.cause.snow': 'neve reduz a marcha e a visibilidade', 'ui.cmd.wx.cause.air': 'teto baixo e pouca visibilidade limitam ataques aéreos', 'ui.cmd.wx.cause.ok': 'sem efeitos relevantes',
  'ui.cmd.abbr': 'A/D/L/M',
};
for (const [k, v] of Object.entries(wx)) d[`ui.cmd.wx.kind.${k}`] = v;
addTexts(d);
