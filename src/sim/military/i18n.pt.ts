/** pt-BR texts of the military module. */
import { UNIT_LIST } from './catalog';

const NAMES: Record<string, string> = {
  infantry: 'Infantaria', mech_infantry: 'Infantaria mecanizada', armor: 'Blindados', recon: 'Reconhecimento', artillery: 'Artilharia',
  mlrs: 'Lançadores de foguetes', air_defense: 'Defesa antiaérea', engineer: 'Engenharia', logistics: 'Logística', special_forces: 'Forças especiais',
  attack_heli: 'Helicópteros de ataque', transport_heli: 'Helicópteros de transporte', fighter: 'Caças', bomber: 'Bombardeiros',
  air_transport: 'Transporte aéreo', drone: 'Drones', destroyer: 'Destróier', frigate: 'Fragata', submarine: 'Submarino',
  carrier: 'Porta-aviões', landing_ship: 'Navio de desembarque', cruise_missile: 'Míssil de cruzeiro', ballistic_missile: 'Míssil balístico', nuke: 'Ogiva nuclear',
};

export const milPt: Record<string, string> = {
  ...Object.fromEntries(UNIT_LIST.map((u) => [`mil.unit.${u.id}`, NAMES[u.id]])),
  'mil.news.noPath': '{name}: sem caminho possível ({reason}).',
  'mil.news.halted': '{name} parou na fronteira: sem acesso militar.',
  'mil.news.casualties': 'Baixas em combate.',
  'mil.news.battleStarted': 'Batalha entre {a} e {d}.',
  'mil.news.occupied': 'Província {province} ocupada por {by}.',
  'mil.news.strike': 'Ataque de {a} contra {d} ({kind}).',
  'mil.news.nuke': 'Detonação nuclear de {a} sobre {d}!',
  'mil.news.rebels': 'Rebeldes se levantam em {province} ({country}).',
  'mil.cost.production': 'Produção militar', 'mil.cost.reinforce': 'Reforço de tropas',
  'err.mil.cannotMove': 'Esta formação não pode se mover.', 'err.mil.noAccess': 'Sem acesso militar ao território de destino.',
  'err.mil.destSea': 'Destino no mar.', 'err.mil.noLandPath': 'Não há caminho por terra.', 'err.mil.noSeaPath': 'Não há rota marítima.',
  'err.mil.embarked': 'Formação embarcada.', 'err.mil.inBattle': 'Formação em batalha.', 'err.mil.noAirbase': 'Sem aeródromo acessível no destino.',
  'err.mil.outOfRange': 'Fora do alcance.', 'err.mil.notYours': 'Formação de outro país.', 'err.mil.noSuchFormation': 'Formação inexistente.',
  'err.mil.cannotDefend': 'Só tropas terrestres podem entrincheirar.', 'err.mil.badTarget': 'Alvo inválido.', 'err.mil.notAtWar': 'Não estamos em guerra com o alvo.',
  'err.mil.unknownUnit': 'Unidade desconhecida.', 'err.mil.locked': 'Unidade ainda não pesquisada.', 'err.mil.badBase': 'Base inválida para esta unidade.',
  'err.mil.queueFull': 'Fila de produção cheia.', 'err.mil.noSuchItem': 'Item inexistente.', 'err.mil.tooFar': 'Formações distantes demais.',
  'err.mil.cannotMerge': 'Não é possível fundir.', 'err.mil.cannotSplit': 'Não é possível dividir.', 'err.mil.cannotEmbark': 'Não pode embarcar.',
  'err.mil.tooHeavy': 'Carga pesada demais.', 'err.mil.noCapacity': 'Sem capacidade de transporte.', 'err.mil.notEmbarked': 'Formação não está embarcada.',
  'err.mil.carrierMoving': 'Transporte em movimento.', 'err.mil.noLanding': 'Sem costa para desembarcar.', 'err.mil.notAir': 'Apenas forças aéreas.',
  'err.mil.onMission': 'Já em missão.', 'err.mil.lowOrg': 'Organização baixa.', 'err.mil.noStrikeUnits': 'Sem unidades de ataque.',
  'err.mil.ownTarget': 'Alvo é seu próprio país.', 'err.mil.noMissiles': 'Sem mísseis em estoque.', 'err.mil.noSuchBattle': 'Batalha inexistente.',
};

/** Rank names by `${rank}.${domain}`. */
export const RANK_PT: Record<string, string> = {
  'brigadier.land': 'General de Brigada', 'major.land': 'General de Divisão', 'lieutenant.land': 'Tenente-General', 'general.land': 'General de Exército', 'marshal.land': 'Marechal',
  'brigadier.naval': 'Contra-Almirante', 'major.naval': 'Vice-Almirante', 'lieutenant.naval': 'Almirante de Esquadra', 'general.naval': 'Almirante', 'marshal.naval': 'Grande Almirante',
  'brigadier.air': 'Brigadeiro', 'major.air': 'Major-Brigadeiro', 'lieutenant.air': 'Tenente-Brigadeiro', 'general.air': 'Marechal do Ar', 'marshal.air': 'Marechal-Chefe do Ar',
};
const TRAIT_PT: Record<string, [string, string]> = {
  armor: ['Especialista blindado', '+12% ataque e +6% defesa com formações de maioria blindada/mecanizada.'],
  urban: ['Combate urbano', '+10% ataque e +12% defesa em batalhas dentro de cidades.'],
  mountain: ['Guerra de montanha', '+10% em terreno acidentado e +8% de velocidade fora de estrada em relevo difícil.'],
  winter: ['Guerra de inverno', '+10% no frio; sofre bem menos fadiga por frio; avança melhor na neve e na lama.'],
  stubborn: ['Defensor obstinado', '+10% defesa; tropas perdem menos moral; mas arrisca a vida (maior chance de morrer).'],
  aggressive: ['Agressivo', '+8% ataque, -5% defesa.'],
  logistic: ['Logístico', '+5% suprimento da formação e menos fadiga acumulada.'],
  air: ['Aviação', '+12% ataque e +8% defesa com asas aéreas.'],
  sea: ['Lobo do mar', '+12% ataque e +8% defesa com frotas.'],
};
export const milCommandPt: Record<string, string> = {
  ...RANK_PT_KEYS(),
  ...Object.fromEntries(Object.entries(TRAIT_PT).flatMap(([k, [n, d]]) => [[`mil.trait.${k}`, n], [`mil.trait.${k}.desc`, d]])),
  'mil.news.officer.wounded': '{rank} {name} foi ferido em combate e está afastado.',
  'mil.news.officer.captured': '{rank} {name} foi capturado pelo inimigo!',
  'mil.news.officer.killed': '{rank} {name} morreu em combate.',
  'mil.news.plot': 'Generais conspiram contra o governo (general {name}).',
  'mil.cause.generalsPlot': 'Generais descontentes', 'mil.cause.defeat': 'Derrota militar', 'mil.cause.lowWarSupport': 'Baixo apoio popular à guerra',
  'mil.cause.highWarSupport': 'Moral elevada pelas vitórias', 'mil.maintenance': 'Manutenção de equipamentos',
  'err.mil.noSuchOfficer': 'Oficial inexistente.', 'err.mil.officerUnavailable': 'O oficial está ferido, capturado ou morto.', 'err.mil.wrongDomain': 'O oficial é de outra arma (terra/ar/mar).',
};
function RANK_PT_KEYS(): Record<string, string> {
  return Object.fromEntries(Object.entries(RANK_PT).map(([k, v]) => [`mil.rank.${k}`, v]));
}

Object.assign(milPt, milCommandPt);
