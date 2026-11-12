/** pt-BR strings of the economy module. */
export const economyPt: Record<string, string> = {
  // ledger
  'eco.ledger.incomeTax': 'Imposto de renda', 'eco.ledger.corporateTax': 'Imposto sobre empresas', 'eco.ledger.consumptionTax': 'Imposto sobre consumo',
  'eco.ledger.trade': 'Comércio exterior (parte estatal)', 'eco.ledger.health': 'Saúde', 'eco.ledger.education': 'Educação', 'eco.ledger.security': 'Segurança',
  'eco.ledger.infrastructure': 'Infraestrutura', 'eco.ledger.social': 'Assistência social', 'eco.ledger.defense': 'Defesa (investimento)',
  'eco.ledger.research': 'Pesquisa', 'eco.ledger.militaryUpkeep': 'Manutenção militar', 'eco.ledger.interest': 'Juros da dívida',
  'eco.ledger.maintenance': 'Manutenção de construções', 'eco.ledger.construction': 'Construção', 'eco.ledger.repair': 'Reparo', 'eco.ledger.refund': 'Reembolso',
  // pillars / taxes / sectors / resources / fuels
  'eco.pillar.health': 'Saúde', 'eco.pillar.education': 'Educação', 'eco.pillar.security': 'Segurança', 'eco.pillar.infrastructure': 'Infraestrutura',
  'eco.pillar.social': 'Social', 'eco.pillar.defense': 'Defesa', 'eco.pillar.research': 'Pesquisa',
  'eco.tax.income': 'Renda', 'eco.tax.corporate': 'Empresas', 'eco.tax.consumption': 'Consumo',
  'eco.sector.agro': 'Agropecuária', 'eco.sector.industry': 'Indústria', 'eco.sector.services': 'Serviços', 'eco.sector.energy': 'Energia', 'eco.sector.extraction': 'Extração',
  'eco.res.money': 'Dinheiro', 'eco.res.energy': 'Energia', 'eco.res.oil': 'Petróleo', 'eco.res.food': 'Alimentos', 'eco.res.steel': 'Aço', 'eco.res.electronics': 'Eletrônicos',
  'eco.res.rareEarth': 'Terras raras', 'eco.res.uranium': 'Urânio', 'eco.res.munitions': 'Munições', 'eco.res.consumerGoods': 'Bens de consumo',
  'eco.fuel.coal': 'Carvão', 'eco.fuel.gas': 'Gás', 'eco.fuel.oil': 'Óleo', 'eco.fuel.nuclear': 'Nuclear', 'eco.fuel.hydro': 'Hidrelétrica', 'eco.fuel.wind': 'Eólica',
  'eco.fuel.solar': 'Solar', 'eco.fuel.biomass': 'Biomassa', 'eco.fuel.geothermal': 'Geotérmica', 'eco.fuel.other': 'Outras / não catalogada',
  // satisfaction causes
  'eco.cause.tax': 'Impostos', 'eco.cause.jobs': 'Emprego e renda', 'eco.cause.energy': 'Energia e apagões', 'eco.cause.food': 'Comida', 'eco.cause.goods': 'Bens de consumo',
  'eco.cause.health': 'Saúde', 'eco.cause.education': 'Educação', 'eco.cause.security': 'Segurança', 'eco.cause.war': 'Guerra, bombardeio e ocupação',
  'eco.cause.ideology': 'Ideologia do governo', 'eco.cause.events': 'Eventos e agitação', 'eco.cause.refugees': 'Chegada de refugiados', 'eco.cause.casualties': 'Baixas de guerra',
  // construction
  'eco.build.plant.coal': 'Usina a carvão', 'eco.build.plant.gas': 'Usina a gás', 'eco.build.plant.oil': 'Usina a óleo', 'eco.build.plant.nuclear': 'Usina nuclear',
  'eco.build.plant.hydro': 'Hidrelétrica', 'eco.build.plant.wind': 'Parque eólico', 'eco.build.plant.solar': 'Usina solar', 'eco.build.plant.biomass': 'Usina de biomassa',
  'eco.build.plant.geothermal': 'Usina geotérmica', 'eco.build.civilFactory': 'Fábrica civil', 'eco.build.militaryFactory': 'Fábrica militar', 'eco.build.refinery': 'Refinaria',
  'eco.build.mine.steel': 'Mina de ferro/aço', 'eco.build.mine.rareEarth': 'Mina de terras raras', 'eco.build.mine.uranium': 'Mina de urânio', 'eco.build.mine.oil': 'Poços de petróleo',
  'eco.build.farm': 'Fazenda', 'eco.build.hospital': 'Hospital', 'eco.build.university': 'Universidade', 'eco.build.road': 'Estrada', 'eco.build.railway': 'Ferrovia',
  'eco.build.port': 'Porto', 'eco.build.airport': 'Aeroporto', 'eco.build.militaryBase': 'Base militar', 'eco.build.airDefense': 'Defesa antiaérea', 'eco.build.radar': 'Radar',
  'eco.build.silo': 'Silo de mísseis', 'eco.build.bunker': 'Bunker',
  // errors
  'eco.err.noCountry': 'País inexistente ou eliminado.', 'eco.err.invalidValue': 'Valor inválido.', 'eco.err.invalidAmount': 'Quantidade inválida.',
  'eco.err.noMoney': 'Fundos insuficientes.', 'eco.err.noStock': 'Sem estoque.', 'eco.err.blockaded': 'Comércio bloqueado.', 'eco.err.debtLimit': 'Limite de endividamento atingido.',
  'eco.err.techLocked': 'Requer tecnologia ainda não pesquisada.', 'eco.err.needsBase': 'Requer uma base militar no país.', 'eco.err.queueFull': 'Fila de construção cheia.',
  'eco.err.badLocation': 'Local inválido.', 'eco.err.notOwned': 'Local fora do seu controle.', 'eco.err.needsCoast': 'Requer província costeira.',
  'eco.err.needsCity': 'Requer cidade com ao menos 50 mil habitantes.', 'eco.err.unknownKind': 'Construção desconhecida.', 'eco.err.badNodes': 'Nós de estrada inválidos.',
  'eco.err.unknownStructure': 'Construção inexistente.', 'eco.err.alreadyBuilt': 'Já concluída.', 'eco.err.noDamage': 'Nada a reparar.', 'eco.err.alreadyRepairing': 'Reparo já em andamento.',
  // news
  'eco.news.blackout': 'Apagões: a oferta de energia cobre só {ratio}% da demanda.', 'eco.news.insolvent': 'O governo está insolvente e perde acesso a crédito.',
  'eco.news.strike': 'Greves paralisam {pct}% da população urbana.', 'eco.news.protest': 'Protestos em massa (aprovação {approval}%).',
  'eco.news.revolt': 'Revolta armada em {city}.', 'eco.news.coup': 'Golpe de Estado em {country}.', 'eco.news.electionWon': 'Governo reeleito (aprovação {approval}%).',
  'eco.news.electionLost': 'Governo derrotado nas eleições (aprovação {approval}%).', 'eco.news.shortage': 'Escassez de {resource}: {pct}% da demanda sem atender.',
  'eco.news.structureDone': 'Construção concluída: {kind} {fuel} {mw} MW.',
  'eco.summary.rating': 'Classificação de crédito',
};
