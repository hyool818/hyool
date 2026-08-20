import type { WorkerResizeOptions } from './meta.js';
import type { InitInput as InitResizeInput } from './lib/resize/pkg/squoosh_resize.js';
import type { InitInput as InitHqxInput } from './lib/hqx/pkg/squooshhqx.js';
import type { InitInput as InitMagicKernelInput } from './lib/magic-kernel/pkg/jsquash_magic_kernel.js';
export declare function initResize(moduleOrPath?: InitResizeInput): Promise<unknown>;
export declare function initHqx(moduleOrPath?: InitHqxInput): Promise<unknown>;
export declare function initMagicKernel(moduleOrPath?: InitMagicKernelInput): Promise<unknown>;
export default function resize(data: ImageData, overrideOptions: Partial<WorkerResizeOptions> & {
    width: number;
    height: number;
}): Promise<ImageData>;
//# sourceMappingURL=index.d.ts.map