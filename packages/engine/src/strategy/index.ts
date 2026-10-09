export { compileStrategy, normalizeParams, type CompiledStrategy } from './compile.ts';
export { validateStrategy } from './validate.ts';
export { getAtPointer, setAtPointer, applyGenome, parsePointer, clampGene } from './pointer.ts';
export { describeCondition, describeStrategy, describeOperand, describeDistance } from './describe.ts';
export { BLOCK_CATALOG, mirrorCondition, cardGenes, type BlockCard, type BlockGroup } from './blocks.ts';
export { STRATEGY_TEMPLATES } from './templates.ts';
export { autoGenes, mirrorGenes, linkMirrorGenes } from './genes.ts';
