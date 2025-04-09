export class RateLimiter {
    private limitedFunc: () => void;
    private pendingCallCount: number;
    private initialDelay: number;
    private isInitialDelayOver: boolean;
    private repeatInterval: number;
    private initialTimeout: NodeJS.Timeout | null;
    private repeatTimeout: NodeJS.Timeout | null;

    constructor(limitedFunc: () => void, initialDelay: number, repeatInterval: number) {
        this.limitedFunc = limitedFunc;
        this.pendingCallCount = 0;
        this.initialDelay = initialDelay;
        this.isInitialDelayOver = false;
        this.repeatInterval = repeatInterval;
        this.initialTimeout = null;
        this.repeatTimeout = null;
    }

    // many events trigger the fire function
    public fire(repeated: boolean = false) {
        // pendingCallCounts records the count to execute the function
        if (!repeated) {
            this.pendingCallCount++;
        }

        if (!this.isInitialDelayOver) {
            if (this.initialDelay > 0) {
                if (this.initialTimeout !== null) {
                    return;
                }

                this.startInitialTimeout();
                return;
            }

            this.isInitialDelayOver = true;
        }

        // make sure the lattern calls are from timer: repeatTimeout is null maker the timer execute time
        if (this.repeatTimeout !== null) {
            return;
        }

        // an execution account for all the pending calls
        this.pendingCallCount = 0;
        this.limitedFunc();

        this.repeatTimeout = setTimeout(
            () => {
                // an execution account for all the pending calls, so cancel all the timer
                this.repeatTimeout = null;
                // after exeute the limited function and repeatInterval time may be because the context switch when others trigger new fires
                if (this.pendingCallCount === 0) {
                    this.reset();
                    return;
                }
                // if other trigger new fires, catch the cpu time to response to the pending calls
                this.fire(true);
            },
            this.repeatInterval
        );
    }

    private startInitialTimeout() {
        this.initialTimeout = setTimeout(
            () => {
                this.isInitialDelayOver = true;
                this.fire(true);
            },
            this.initialDelay
        );
    }

    private reset() {
        this.initialTimeout = null;
        this.isInitialDelayOver = false;
        this.repeatTimeout = null;

    }
}